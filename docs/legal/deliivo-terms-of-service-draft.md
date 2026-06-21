# Deliivo Terms Of Service - Detailed Product Draft

Status: Draft for legal review  
Last updated: 2026-06-20  
Jurisdiction focus: Estonia, Latvia, Lithuania, and broader EU/EEA operation  
Contact: legal@deliivo.com

> This document is a product and technical draft based on the implemented Deliivo platform flows. It is not legal advice. A qualified lawyer should review and adapt it before publication.

## 1. Introduction

These Terms of Service govern access to and use of Deliivo, a carpooling marketplace that allows drivers to publish shared rides and riders to search, request, pay for, join, track, and review rides.

Deliivo is intended to support shared mobility across the Baltic region, including Estonia, Latvia, and Lithuania. The platform currently includes web portal functionality for authentication, onboarding, ride publishing, ride search, booking requests, payments, driver approvals, ride-day operations, live tracking links, notifications, disputes, ratings, and admin support.

By creating an account, browsing rides, publishing a ride, booking a ride, accepting a booking request, making or receiving payments, or otherwise using Deliivo, the user agrees to these Terms.

If the user does not agree with these Terms, they must not use Deliivo.

## 2. Key Definitions

**Deliivo**, **we**, **us**, or **our** means the operator of the Deliivo platform.

**Platform** means the Deliivo web portal, APIs, future mobile applications, notifications, tracking links, admin systems, and related services.

**User** means any person using Deliivo, including riders, drivers, and admins.

**Rider** means a user who searches for, requests, books, pays for, joins, or completes a ride as a passenger.

**Driver** means a user who publishes a ride, offers seats, accepts or rejects booking requests, manages ride-day operations, and may receive payouts.

**Ride** means a driver-published travel offer with route, waypoints, schedule, seat capacity, vehicle, pricing, preferences, and status.

**Booking** means a rider's request or confirmed participation in a ride, including route segment, seat count, payment status, driver decision state, pickup/drop-off state, and dispute state.

**Waypoint** or **stopover** means a point on a ride route that may be used for pickup or drop-off.

**Segment** means part of a ride route between pickup and drop-off points. Deliivo may calculate capacity and pricing on a segment basis.

**Payment Provider** means Stripe or any other provider Deliivo uses to process cards, payments, refunds, Connect onboarding, transfers, or payouts.

**Tracking Link** means a limited public or private link that allows a viewer to see live ride tracking information for a limited period.

**Dispute** means a rider, driver, or admin-created case related to safety, pickup, no-show, drop-off, cancellation, payment, refund, payout, conduct, or other ride issues.

## 3. Deliivo's Role As A Marketplace

Deliivo provides technology that helps riders and drivers arrange shared rides. Deliivo is not the driver, carrier, taxi provider, bus operator, transport company, insurer, employer, agent of a driver, or agent of a rider unless explicitly required by law.

Drivers are independent users who choose whether to publish rides, accept riders, and complete trips. Riders choose whether to request and join rides. Users are responsible for their own conduct, compliance, and safety decisions.

Deliivo may provide:

- account and identity features;
- ride publishing and search;
- booking request and approval workflows;
- pricing, fees, and payment collection;
- saved payment methods;
- payout readiness and Stripe Connect onboarding;
- notifications, email, SMS, and push-capable communication;
- live tracking and tracking links;
- safety, reports, ratings, disputes, and admin review;
- development or test-mode simulation tools where enabled.

Deliivo may review, restrict, suspend, or remove activity where needed for safety, fraud prevention, legal compliance, platform integrity, payment risk, or user support.

## 4. Eligibility

Users must be legally capable of entering into these Terms. Where local law sets a minimum age or specific requirements for riding, driving, payments, vehicle use, or online services, the user must satisfy those requirements.

Drivers must:

- hold a valid driving license for the vehicle and route;
- comply with traffic, vehicle, insurance, passenger, and road-safety laws;
- use a roadworthy vehicle;
- provide accurate vehicle and profile details;
- complete verification and payout-readiness steps where required;
- not operate Deliivo as an unauthorized commercial transport service where local law prohibits it.

Riders must:

- provide accurate profile and contact details;
- comply with driver ride rules and platform policies;
- be present at pickup points on time;
- not misuse no-show, dispute, refund, or cancellation flows.

Deliivo may require additional verification, identity checks, document checks, driver license verification, payout verification, or risk review before enabling certain features.

## 5. Accounts, Authentication, And Security

Deliivo may use OTP-based login, access tokens, refresh tokens, and other authentication mechanisms. Users must keep their devices, email, phone, and account credentials secure.

Users must not:

- create false or misleading accounts;
- impersonate another person;
- share accounts with unauthorized people;
- bypass authentication, verification, payment, or security controls;
- use automated scripts or scraping without written permission;
- exploit test, mock, or development features outside authorized environments.

Users are responsible for activity under their accounts unless the activity resulted from Deliivo's own failure to apply reasonable security measures.

## 6. Profile, Gender, Trust, And Verification

Deliivo uses profile information to support marketplace trust, ride matching, safety filters, and user confidence.

Users may be asked to provide:

- name or display name;
- email and phone;
- profile photo;
- gender;
- travel preferences;
- rating and reputation data;
- vehicle and document details for drivers;
- payout account readiness for drivers;
- verification data where required.

Gender is used for trust and safety flows such as women-only rides. Users must provide accurate gender information when using features that rely on it. Misrepresenting eligibility for safety-filtered rides may lead to cancellation, restriction, suspension, or dispute action.

Drivers may need to add a vehicle and complete driving license or document verification before publishing rides. Development environments may include verification bypasses for testing, but those bypasses do not apply to production users.

## 7. Ride Publishing Rules For Drivers

Drivers must publish accurate ride information, including:

- origin and destination;
- route and stopovers;
- departure date and time;
- available seats;
- price per seat or segment;
- luggage or special conditions where applicable;
- vehicle information;
- ride preferences such as women-only, no smoking, no bicycles, and child-seat availability;
- notes relevant to pickup, drop-off, or rider expectations.

Drivers must not publish rides that:

- they do not intend to operate;
- use misleading pickup/drop-off locations;
- misrepresent vehicle, capacity, route, schedule, gender eligibility, or safety preferences;
- violate local transport, licensing, insurance, tax, or passenger rules;
- are priced or operated in a way that makes the ride an unlawful commercial transport service.

Deliivo may limit, remove, cancel, hide, or investigate rides if it detects safety, payment, compliance, fraud, capacity, or quality issues.

## 8. Ride Search And Booking Rules For Riders

Riders must review the ride details before requesting a booking, including:

- origin, destination, pickup point, and drop-off point;
- stopovers and segment context;
- departure date and time;
- seat count;
- price breakdown;
- driver profile and rating;
- vehicle information;
- ride preferences and eligibility;
- cancellation and expiry information;
- terms and privacy acceptance requirements.

A booking request may require payment confirmation before the driver receives it. In the current product direction, a rider generally selects a saved card or adds card details during booking. The driver then accepts or rejects the request.

A rider must not:

- request rides they do not intend to join;
- book seats for unauthorized third parties where not supported;
- bypass payment or platform booking flow;
- intentionally provide false pickup or drop-off information;
- misuse women-only eligibility or other safety filters;
- repeatedly cancel, no-show, or dispute without valid reason.

## 9. Booking Request Expiry And Driver Decision

Booking requests may include a rider-selected expiry window, such as one hour, three hours, six hours, twelve hours, twenty-four hours, or before departure, depending on the available product options.

If a driver does not accept a booking before the deadline, the booking may expire, be cancelled, or follow a recovery/extension flow depending on platform rules.

Drivers may accept or reject booking requests. Rejections and cancellations may require a reason. Deliivo may notify the rider and may update payment, refund, capacity, and dispute state accordingly.

Repeated clicks, duplicate requests, or stale screens may be blocked where the booking has already moved to another state.

## 10. Payments, Pricing, Fees, And Payouts

Deliivo may use Stripe or another payment provider to process rider card payments, store payment method metadata, manage payment intents, handle refunds, onboard drivers to payout accounts, and create transfers or payouts.

Riders may be charged:

- ride fare;
- segment fare;
- seat subtotal;
- service fee or platform fee;
- luggage or additional fee where configured;
- taxes or charges required by law, if applicable.

Drivers may receive payouts after ride completion or payout eligibility checks, subject to:

- driver acceptance and ride completion;
- payment capture and reconciliation;
- open dispute status;
- refund rules;
- cancellation/no-show/missed-pickup rules;
- driver Stripe Connect or payout account readiness;
- admin review or payout batch processing.

Deliivo may charge a commission, service fee, platform fee, or other fee disclosed in the booking or payout flow. Fee policy may change over time, but historical transactions should remain governed by the price and fee snapshot shown at the time of booking or publication where technically recorded.

Deliivo does not store full card numbers. Payment providers handle sensitive card data. Deliivo stores operational metadata such as payment method brand, last four digits, payment intent IDs, payment status, refund status, payout status, and ledger entries.

## 11. Refunds, Cancellations, No-Shows, And Missed Pickup

Deliivo may support cancellations by riders, drivers, or admins. Cancellation outcomes may depend on:

- timing relative to departure;
- whether payment was authorized, captured, or refunded;
- driver acceptance state;
- whether the driver started the ride;
- rider and driver arrival evidence;
- OTP verification;
- no-show or missed-pickup evidence;
- dispute result;
- admin or automated decision.

Drivers may mark a rider as no-show where the rider does not appear at the pickup point within the allowed time or according to platform rules. Riders may report that a driver missed pickup. Both flows may store evidence such as timestamps, GPS coordinates, ride events, and user actions.

Deliivo may withhold, refund, partially refund, release, or adjust payment and payout amounts according to the applicable cancellation, no-show, dispute, and reconciliation rules.

Because the final refund matrix may depend on local law and operational policy, Deliivo should publish a user-facing cancellation and refund policy before launch.

## 12. Ride-Day Operations

Drivers and riders must follow ride-day steps shown in the app.

Driver ride-day actions may include:

- starting the ride;
- sharing location;
- marking arrival at passenger pickup point;
- verifying rider pickup OTP;
- using approved manual fallback where OTP is unavailable;
- marking no-show with evidence;
- confirming drop-off;
- finishing the ride.

Rider ride-day actions may include:

- viewing booking and pickup details;
- marking arrival at pickup point;
- showing pickup OTP to the driver;
- opening or sharing a live tracking link;
- confirming drop-off;
- reporting missed pickup or another issue;
- rating the ride after eligible completion.

Users must not falsify ride-day evidence, misuse location simulation, share OTPs before pickup, impersonate another rider, or manipulate no-show/drop-off/dispute flows.

## 13. Live Tracking And Tracking Links

Deliivo may process driver location updates during active ride-day flows. Location updates may support:

- rider visibility;
- live tracking links;
- pickup/drop-off evidence;
- safety review;
- dispute resolution;
- admin support.

Tracking links may be public or limited-access links that show minimal ride-tracking information. Users should share tracking links only with trusted recipients. Deliivo may expire, revoke, limit, or disable tracking links.

Deliivo should not expose unnecessary profile, payment, phone, or sensitive identity information through tracking links.

## 14. Communications, Notifications, Email, SMS, Push, And Chat

Deliivo may send service messages through:

- in-app notifications;
- Socket.IO realtime updates;
- browser push where configured;
- Firebase-backed push-capable clients;
- email;
- SMS;
- chat or message features.

Service communications may include:

- signup and OTP messages;
- ride publish state;
- booking request state;
- payment confirmation or failure;
- driver acceptance or rejection;
- ride start and live tracking link;
- pickup/drop-off updates;
- cancellation, no-show, and missed-pickup updates;
- dispute and admin actions;
- payout and reconciliation updates;
- policy, safety, or account notices.

Users are responsible for keeping contact information current. Deliivo is not responsible for delays or failures caused by third-party email, SMS, push, payment, or network providers, but it should preserve core marketplace state in durable records.

## 15. Safety, Conduct, And Prohibited Use

Users must treat others respectfully and comply with safety rules.

Prohibited conduct includes:

- harassment, threats, hate, abuse, discrimination, or unsafe conduct;
- false identity, false gender eligibility, or false vehicle information;
- payment bypass, chargeback abuse, or refund manipulation;
- publishing or booking misleading rides;
- unsafe driving, illegal transport, intoxicated driving, or dangerous pickup/drop-off behavior;
- carrying illegal items or violating vehicle restrictions;
- misusing live tracking, OTP, notification, or dispute systems;
- scraping, attacking, reverse engineering, or disrupting the platform;
- using Deliivo for criminal, fraudulent, or unauthorized commercial activity.

Deliivo may restrict, suspend, terminate, cancel, refund, withhold payouts, report, or cooperate with authorities where safety, fraud, legal, or platform integrity concerns arise.

## 16. Women-Only And Preference-Based Rides

Deliivo may support women-only rides and ride preferences such as no smoking, no bicycles, and child-seat availability.

Drivers are responsible for setting accurate ride preferences. Riders are responsible for respecting preferences before and during the ride.

Women-only rides are intended as a safety and trust feature. Eligibility may depend on the user's profile gender field. Deliivo may prevent booking, cancel bookings, or take account action where a user misrepresents eligibility or circumvents the feature.

Deliivo does not guarantee that preferences eliminate all safety risk. Users must still use personal judgment and report concerns.

## 17. Ratings, Reports, Blocking, And Reputation

Deliivo may allow users to rate completed or eligible rides and report or block users. Ratings and ride counts may appear in profiles, search results, and marketplace decision points.

Users must provide honest ratings and reports. Deliivo may remove or restrict content that is fraudulent, abusive, discriminatory, irrelevant, unsafe, or legally problematic.

Ratings, reports, successful driver ride counts, successful rider ride counts, and dispute history may influence trust, visibility, admin review, and platform enforcement.

## 18. Disputes And Admin Review

Users may submit disputes or issue reports related to:

- pickup or missed pickup;
- no-show;
- drop-off;
- safety;
- behavior;
- route or vehicle mismatch;
- payment, refund, or payout;
- other ride-related concerns.

Deliivo may collect and review evidence, including:

- ride details;
- booking details;
- payment and refund metadata;
- payout and ledger metadata;
- timestamps;
- driver and rider operational actions;
- OTP verification status;
- live location updates;
- tracking link records;
- notifications;
- messages where relevant;
- user-submitted descriptions and evidence.

Disputes may be resolved automatically, manually by admin, escalated, or reopened depending on platform rules. Decisions may affect refunds, payouts, account restrictions, ratings, reports, and reconciliation records.

Deliivo aims to make dispute decisions auditable, but the exact resolution process may depend on operational policy and applicable law.

## 19. Admin Operations And Support Overrides

Authorized admins may inspect and act on user, ride, booking, payment, payout, dispute, revenue, reconciliation, notification, and support records.

Admin actions may include:

- reviewing users and ride history;
- searching by ride, booking, driver, rider, contact, or route details;
- reviewing revenue ledger entries;
- collecting dispute evidence;
- resolving disputes;
- confirming payout or reconciliation status;
- applying force-refund or support overrides where allowed.

Admin actions must be used only for legitimate support, safety, financial, legal, fraud-prevention, or operational purposes.

## 20. Test Mode, Development Mode, And Simulation

Deliivo may include development-only features such as:

- mock vehicle or license verification;
- mock SMS/payment modes;
- ride-day simulation;
- simulated location updates;
- bypassing schedule restrictions for testing;
- exposed OTP values for development.

These features must be disabled in production unless explicitly approved for a controlled environment. Users must not rely on development behavior in production.

## 21. Third-Party Services

Deliivo may integrate with third parties including:

- Stripe for payments, saved cards, refunds, Connect onboarding, transfers, and payouts;
- Google Maps for geocoding, place details, route computation, and location-related services;
- Veriff or similar providers for driver license or identity verification;
- Firebase for push-capable notifications;
- Twilio for SMS;
- email providers for transactional messages;
- AWS S3 or similar storage for images or documents;
- Redis, database, hosting, monitoring, and infrastructure providers.

Third-party services may have their own terms and privacy policies. Deliivo is not responsible for third-party outages, errors, or policy changes, but it should take reasonable steps to protect users and reconcile platform state.

## 22. User Content And License

Users may submit profile information, photos, vehicle details, ride notes, messages, ratings, reports, dispute descriptions, and other content.

Users retain ownership of their content, but grant Deliivo a worldwide, non-exclusive, royalty-free license to host, store, process, display, transmit, analyze, moderate, and use that content as needed to operate, improve, secure, and enforce the platform.

Users must not submit content that is unlawful, misleading, unsafe, discriminatory, abusive, infringing, or violates another person's rights.

## 23. Platform Availability And Changes

Deliivo may modify, suspend, or discontinue features. Availability may be interrupted by maintenance, hosting issues, third-party failures, payment provider downtime, network failures, or security events.

Deliivo may update pricing rules, supported countries, verification requirements, payment flows, dispute policies, refund policies, payout policies, and admin operations. Material changes should be communicated where required by law.

## 24. Suspension And Termination

Deliivo may suspend or terminate access if a user:

- violates these Terms;
- creates safety or fraud risk;
- misuses payment, dispute, tracking, or notification systems;
- fails verification;
- provides false profile, vehicle, gender, or payout information;
- repeatedly cancels, no-shows, or receives unresolved reports;
- violates applicable law;
- causes risk to users, Deliivo, or third parties.

Users may stop using Deliivo at any time. Account deletion may be subject to retention obligations for payments, safety, disputes, accounting, fraud prevention, or legal compliance.

## 25. Disclaimers

Deliivo does not guarantee:

- that every driver or rider will behave safely or reliably;
- ride availability;
- exact arrival, departure, pickup, drop-off, ETA, or route timing;
- uninterrupted platform operation;
- that third-party provider services will always work;
- that all disputes will be resolved in a user's favor.

Deliivo may provide trust, verification, ratings, and tracking features, but these do not eliminate all risk. Users remain responsible for assessing whether to publish, request, accept, join, or complete a ride.

## 26. Limitation Of Liability

To the maximum extent permitted by applicable law, Deliivo is not liable for indirect, incidental, special, consequential, punitive, or loss-of-profit damages arising from platform use, ride interactions, third-party services, payment failures, tracking failures, user conduct, or unavailable services.

Deliivo's liability should be limited according to applicable law and any final legal policy approved for launch. This section must be reviewed by counsel for enforceability in the relevant jurisdictions.

Nothing in these Terms limits liability where prohibited by law, including liability for intentional misconduct, gross negligence, death or personal injury where such limitation is unlawful, consumer rights that cannot be waived, or statutory obligations.

## 27. Indemnity

Where permitted by law, users agree to compensate Deliivo for losses, claims, damages, costs, and expenses arising from:

- violation of these Terms;
- unsafe or unlawful conduct;
- false profile, vehicle, gender, payment, or payout information;
- misuse of rides, payments, tracking, or disputes;
- infringement of third-party rights;
- violation of traffic, insurance, tax, licensing, passenger, or transport laws.

This section must be reviewed for consumer-law enforceability before publication.

## 28. Governing Law And Dispute Resolution

The governing law and dispute resolution forum should be determined by Deliivo's operating company, place of establishment, consumer-law obligations, and launch jurisdictions.

For an Estonia-headquartered launch, the draft business position may be:

- governing law: Estonia, subject to mandatory consumer protection laws;
- jurisdiction: competent courts or consumer dispute bodies where legally required;
- EU consumer rights: users retain mandatory rights available under applicable EU/EEA consumer law.

This section requires legal review before publication.

## 29. Changes To These Terms

Deliivo may update these Terms. If changes are material, Deliivo should notify users by email, in-app notice, or other reasonable means. Continued use after the effective date means acceptance of the updated Terms, unless applicable law requires a different consent process.

Deliivo should store acceptance metadata such as version, timestamp, and privacy acceptance where required for booking and compliance workflows.

## 30. Contact

Questions about these Terms should be sent to:

legal@deliivo.com

Operational support questions should be sent to:

support@deliivo.com

General contact:

contact@deliivo.com

## 31. Publication Checklist

Before publishing these Terms, Deliivo should confirm:

- final legal entity name and registered address;
- final governing law and jurisdiction;
- final age and eligibility rules;
- final insurance and driver compliance position;
- final fee and commission model;
- final cancellation and refund matrix;
- final payout policy;
- final dispute and escalation policy;
- final consumer-rights language;
- final contact emails and support channels;
- final references to mobile app if launched;
- final data retention cross-reference with Privacy Policy.
