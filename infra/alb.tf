# One load balancer for both environments, routed by hostname. Unknown hosts
# get a 404 rather than falling through to production.

locals {
  hosts = {
    production = [var.domain, "www.${var.domain}"]
    staging    = ["staging.${var.domain}"]
  }
}

# ─── Certificate ─────────────────────────────────────────────────────────────
# Replaces the two EB-era certs; the old staging one expires 2026-09-25 and
# cannot renew because nothing uses it.

data "aws_route53_zone" "main" {
  name         = var.domain
  private_zone = false
}

resource "aws_acm_certificate" "main" {
  domain_name               = var.domain
  subject_alternative_names = ["www.${var.domain}", "staging.${var.domain}"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cert_validation" {
  for_each = {
    for o in aws_acm_certificate.main.domain_validation_options : o.domain_name => o
  }

  zone_id         = data.aws_route53_zone.main.zone_id
  name            = each.value.resource_record_name
  type            = each.value.resource_record_type
  records         = [each.value.resource_record_value]
  ttl             = 300
  allow_overwrite = true # apex/www validation records already exist from the EB cert
}

resource "aws_acm_certificate_validation" "main" {
  certificate_arn         = aws_acm_certificate.main.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

# ─── Load balancer ───────────────────────────────────────────────────────────

resource "aws_lb" "main" {
  name               = "bizexec"
  load_balancer_type = "application"
  subnets            = aws_subnet.public[*].id
  security_groups    = [aws_security_group.alb.id]

  drop_invalid_header_fields = true
  idle_timeout               = 120 # extraction status polling, large uploads
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      protocol    = "HTTPS"
      port        = "443"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.main.certificate_arn

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "Not found"
      status_code  = "404"
    }
  }
}

resource "aws_lb_listener_rule" "host" {
  for_each = local.hosts

  listener_arn = aws_lb_listener.https.arn
  priority     = each.key == "production" ? 10 : 20

  action {
    type             = "forward"
    target_group_arn = module.service[each.key].target_group_arn
  }

  condition {
    host_header {
      values = each.value
    }
  }
}
