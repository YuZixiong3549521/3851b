# Service catalogue and pricing

Effective configuration: 24 September 2026. All amounts are SGD. These are CoolCare commercial prices selected with the owner's authorization, informed by published Singapore provider prices. They are not quotations from those providers.

| Customer choice | Minimum / base price | Estimated time |
| --- | --- | --- |
| Cleaning | 50 per AC unit per visit | 45 minutes per unit |
| Repair | 50 minimum diagnostic fee per visit | 60 minutes minimum |
| Cleaning + Repair | Cleaning unit total plus the 50 diagnostic fee | Cleaning time plus 60 minutes |

The technician records any additional repair labour and parts fee, with an explanation and change history. The customer and administrator can see the additional fee and the revised estimate. The owner explicitly requested no customer approval step. Recording a quote does not collect payment.

## Annual Cleaning Bundle

One bundle contains four quarterly cleaning visits at the same address. The technician decides the cleaning method. Property tiers set a package minimum; fewer units do not reduce that minimum.

| Property type | Units included per visit | Annual price | Extra unit, per year |
| --- | ---: | ---: | ---: |
| HDB 2- or 3-room | Up to 2 | 200 | 80 |
| HDB 4-room | Up to 3 | 260 | 80 |
| HDB 5-room / Executive | Up to 4 | 320 | 80 |
| Condominium / Apartment | Up to 4 | 360 | 80 |
| Landed home | Up to 5 | 440 | 80 |

For example, an HDB 4-room property with three units costs 260 per year, allocated as four visits of 65. Four units at that property cost 340 per year, or 85 per visit. A condominium with four units costs 360 per year. Customers pay after each service visit; no payment is collected online.

The first appointment must be a weekday at least 14 calendar days ahead in Singapore time. Subsequent dates are three months apart; weekends move to Monday. The same address may have at most one cleaning visit in each Monday–Sunday calendar week, including combined services and annual visits. Repair-only visits do not consume this cleaning quota. Changes must be made at least 72 hours before the original visit, and the new appointment must also be at least 72 hours ahead. Annual changes stay within that visit's quarterly window.

## Pricing references

Reviewed on 24 September 2026:

- [YS Aircon pricing](https://ysairconsystems.com/pricing/) publishes four-visit annual cleaning prices of 200 for two units and 270 for three units.
- [WeCool Aircon](https://wecoolaircon.com/) publishes annual four-visit rates of 200, 220, 280 and 340 for two through five units.
- [NewCool pricing](https://newcool.sg/cn/pricing/) lists annual rates of 240 for two units, 315 for three, 390 for four and 465 for five.
- [Billy Aircon servicing prices](https://www.billyaircon.com.sg/servicing-price/) lists single-unit routine servicing at 50.
- [Helpling aircon services](https://www.helpling.com.sg/aircon-services) lists a diagnostic service at 60, supporting a separate minimum diagnostic charge.

These sources support the general unit-count and recurring-service price range. The property categories and selected package premiums are CoolCare's own configuration; the sources do not establish a universal property-based market price. Tax treatment has not been inferred from these references.

## Storage and historical orders

Migration 19-booking-policy.sql updates the current cleaning/repair prices once and adds annual_property_pricing. service_catalog and web_service_pricing hold service amounts, while the property table holds each bundle tier. The server calculates duration and end time and reserves enough capacity for the whole visit. Visits extending past 18:00 are unavailable.

All booking entry points use the same catalogue and validation. New orders save price and duration snapshots. Annual series also snapshot the chosen property tier and included units. Existing order prices and annual contracts are preserved, and repeated migrations do not reset later catalogue edits.

Before production launch, configure a verified email sender, production HTTPS/hosting, durable session storage and operational service terms. Local Mailpit only demonstrates email delivery into the local mailbox; it does not send to a customer's external inbox.
