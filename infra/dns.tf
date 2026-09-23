# Apex, www and staging all alias the ECS load balancer. (The Elastic
# Beanstalk fallback used during the 2026-09-23 cutover was removed once EB
# was terminated.)

locals {
  prod_alias = {
    name    = aws_lb.main.dns_name
    zone_id = aws_lb.main.zone_id
  }
}

resource "aws_route53_record" "apex" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = var.domain
  type    = "A"

  alias {
    name                   = local.prod_alias.name
    zone_id                = local.prod_alias.zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "www" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = "www.${var.domain}"
  type    = "A"

  alias {
    name                   = local.prod_alias.name
    zone_id                = local.prod_alias.zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "staging" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = "staging.${var.domain}"
  type    = "A"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}
