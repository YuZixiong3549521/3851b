# Service catalogue and pricing

Effective configuration: 12 September 2026. All amounts are in SGD. These are CoolCare prices chosen with the owner's authorization after reviewing Singapore service providers, not a claimed market average or a quotation issued by another company.

| Customer choice | Base charge | Additional units | Scope |
| --- | ---: | ---: | --- |
| Cleaning | 50 for the first unit | 25 each, per visit | One routine cleaning visit |
| Repair | 50 per diagnostic visit | No automatic additional-unit charge | Diagnosis only; repair labour and parts require a separate quote |
| Annual Cleaning Bundle | 180 for one unit, four visits | 80 each, for the year | Four routine cleaning visits at three-month intervals |

The annual amount is allocated across the four visits: 45 per visit for one unit, plus 20 for each additional unit. Three units therefore cost 340 for the year, allocated as four visits of 85. Booking records represent service requests and estimates, not completed payments. No payment is collected online. The service team confirms availability; customers pay per visit after service.

Prices cover residential wall-mounted units at one address and ordinary travel. Chemical treatment, intensive dismantling, refrigerant, repair labour and replacement parts are not silently added to a booking. The technician assesses the appropriate method and must agree any additional scope and price with the customer before proceeding. Saving a technician assessment does not approve a quote or charge the customer.

## Basis for the pricing decision

Sources reviewed on 12 September 2026:

- [Billy Aircon published prices](https://www.billyaircon.com.sg/aircon-servicing-prices/) list one-unit cleaning at 50, troubleshooting at 40–50, and four-visit annual contracts at 200 for two units, 240 for three and 300 for four. The page's headline still refers to 2025; it is a reference price list, not evidence that a particular appointment can be purchased at that price today.
- [Infinite Aircon service price list](https://infiniteac.com.sg/service/aircon-servicing/) lists single-visit cleaning at 50/70/85/100 for one/two/three/four units and quarterly contract rates per visit at 40/55/70/85. These support a modest reduction for recurring visits. Rates were available in the indexed provider page; a direct fetch returned HTTP 406 during verification.
- [Helpling aircon services](https://www.helpling.com.sg/aircon-services) lists diagnosis at 60 and wall-mounted chemical washing from 80 per unit, with further work explained and quoted after assessment. This supports separating diagnosis and specialist work from the routine cleaning price.

CoolCare uses a simple linear additional-unit rate rather than copying a provider's tiered table. The selected annual rate sits within the range of the reviewed offers; pricing is a commercial configuration, not a production cost or profitability analysis. No GST registration or tax treatment has been inferred from these references.

## Data and future changes

`09-simple-services.sql` seeds separate current catalogue records and preserves old services, packages, subscriptions and historical price snapshots. `service_catalog` and `web_service_pricing` hold the two services' prices; `maintenance_package` and `web_package_details` hold the annual bundle price. `simple_service_catalog` and `simple_package_catalog` identify the available customer choices.

The public pricing cards and authenticated booking forms read the server catalogue. Do not add hardcoded frontend prices or use the old service offers as the new catalogue. New orders snapshot prices; later catalogue changes must not rewrite saved orders. Repeat migrations do not reset price edits.

## Delivery boundary

This change replaces the demonstration catalogue with a consistent service workflow. Public launch still requires the operational parts of delivery: a verified external sender, production hosting and HTTPS, persistent server sessions, an administrative appointment-assignment workflow, agreed business contact and service terms, and a way to issue and approve additional-work quotes. No external delivery, payment, technician availability or legal/tax setup should be marked complete merely because a booking was saved.
