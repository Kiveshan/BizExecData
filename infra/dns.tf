# staging.* goes straight to the new ALB. The apex and www follow
# var.prod_dns_target so the production cutover — and its rollback — is a
# one-variable change.

import {
  to = aws_route53_record.apex
  id = "${data.aws_route53_zone.main.zone_id}_${var.domain}_A"
}

locals {
  prod_alias = var.prod_dns_target == "ecs" ? {
    name    = aws_lb.main.dns_name
    zone_id = aws_lb.main.zone_id
    } : {
    name    = var.legacy_eb_dns_name
    zone_id = "Z1EI3BVKMKK4AM" # Elastic Beanstalk, af-south-1
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
