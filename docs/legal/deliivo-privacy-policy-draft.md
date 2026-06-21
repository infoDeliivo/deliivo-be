# Deliivo Privacy Policy - Detailed Product Draft

Status: Draft for legal review  
Last updated: 2026-06-20  
Jurisdiction focus: Estonia, Latvia, Lithuania, EU/EEA, GDPR  
Contact: privacy@deliivo.com

> This document is a product and technical draft based on the implemented Deliivo platform flows. It is not legal advice. A qualified privacy lawyer or DPO should review and adapt it before publication.

## 1. Introduction

This Privacy Policy explains how Deliivo collects, uses, shares, stores, and protects personal data when users access or use the Deliivo carpooling platform.

Deliivo supports ride publishing, ride search, booking, payments, payouts, ride-day operations, live tracking links, notifications, ratings, disputes, and admin support. These features require processing personal data about riders, drivers, admins, and limited third-party recipients such as live tracking link viewers.

This Privacy Policy should be read together with Deliivo's Terms of Service.

## 2. Controller And Contact

The final legal controller details must be completed before publication.

Draft controller placeholder:

- Controller: Deliivo operating company
- Headquarters: Estonia
- Privacy contact: privacy@deliivo.com
- General contact: contact@deliivo.com
- Support contact: support@deliivo.com
- Legal contact: legal@deliivo.com

If Deliivo appoints a Data Protection Officer or EU representative, their details should be added here.

## 3. Scope

This Privacy Policy applies to:

- Deliivo web portal;
- Deliivo APIs;
- future Deliivo mobile apps where connected to the same platform;
- notifications, email, SMS, and push services;
- public or limited live tracking links;
- admin and support systems;
- payment, payout, dispute, verification, and reconciliation workflows.

This Privacy Policy does not replace the privacy policies of third-party providers such as Stripe, Google Maps, Veriff, Firebase, Twilio, email providers, or banks.

## 4. Data We Collect

### 4.1 Account And Identity Data

Deliivo may collect:

- user ID;
- name;
- display name or nickname;
- email address;
- phone number;
- profile photo or avatar;
- authentication status;
- OTP login information;
- access and refresh token metadata;
- role, such as rider, driver, or admin;
- onboarding status;
- terms and privacy acceptance timestamp and version;
- account status, restrictions, suspension, deletion, or verification state.

### 4.2 Profile, Trust, And Safety Data

Deliivo may collect:

- gender;
- travel preferences;
- chattiness, pet, comfort, or matching preferences where implemented;
- user reports and blocks;
- rating scores and review metadata;
- successful driver ride count;
- successful rider ride count;
- verification state;
- risk, fraud, or support flags where required for safety and marketplace integrity.

Gender is used for safety features such as women-only rides and eligibility checks.

### 4.3 Driver, Vehicle, And Verification Data

For drivers, Deliivo may collect:

- vehicle brand, model, color, plate or vehicle identifier where implemented;
- vehicle type;
- vehicle documents;
- document type and verification status;
- driving license verification state;
- verification provider identifiers;
- uploaded images or documents;
- payout readiness status;
- Stripe Connect account status;
- driver publishing eligibility state.

Production verification may use providers such as Veriff. Development environments may include verification bypasses for testing.

### 4.4 Ride And Route Data

Deliivo may collect:

- ride ID;
- driver ID;
- origin and destination addresses;
- origin and destination coordinates;
- waypoint and stopover details;
- route polyline, distance, and duration;
- departure date and time;
- seat count and available seats;
- route segment capacity;
- pricing snapshot;
- luggage and ride preference information;
- women-only, no-smoking, no-bicycle, and child-seat settings;
- ride status;
- ride notes;
- created, updated, cancelled, completed, or disputed timestamps.

### 4.5 Booking Data

Deliivo may collect:

- booking ID;
- rider ID;
- ride ID;
- segment pickup and drop-off waypoint IDs;
- pickup and drop-off addresses;
- pickup and drop-off coordinates;
- seat count;
- booking status;
- price breakdown;
- request expiry option and deadline;
- driver decision timestamps;
- cancellation reason;
- rejection reason;
- no-show or missed-pickup state;
- OTP state, including pickup OTP display or hash where applicable;
- pickup, onboard, drop-off, and completion timestamps;
- related dispute, rating, payment, and tracking link references.

### 4.6 Payment, Card, Refund, Ledger, And Payout Metadata

Deliivo may collect and store operational metadata for payments and payouts, including:

- Stripe customer ID;
- Stripe payment method ID;
- card brand, last four digits, expiry month, and expiry year;
- payment intent ID;
- charge ID;
- payment amount and currency;
- payment status;
- payment capture status;
- refund ID;
- refund amount and timestamp;
- refund percentage or reason where used;
- payout account status;
- payout batch and payout item IDs;
- transfer or payout provider identifiers;
- ledger entry IDs;
- reconciliation issue IDs;
- admin action metadata.

Deliivo does not store full card numbers, CVC, or raw card data. Those are handled by the payment provider.

### 4.7 Ride-Day Operations And Evidence

Deliivo may collect ride-day evidence such as:

- driver start ride action;
- driver arrived action;
- rider arrived at pickup action;
- OTP verification action;
- manual pickup fallback action;
- no-show action;
- missed-pickup report;
- driver drop-off action;
- rider drop-off confirmation;
- finish ride action;
- action IDs;
- client timestamps;
- server timestamps;
- actor user ID;
- related booking and ride IDs;
- GPS coordinates where available;
- location accuracy where available;
- IP, device, or request metadata where needed for security and audit.

This evidence supports ride state, safety review, disputes, refunds, payouts, reconciliation, and support.

### 4.8 Location And Tracking Data

Deliivo may collect:

- driver live location updates during active ride flows;
- historical location updates linked to a ride;
- pickup and drop-off evidence coordinates;
- live tracking link token;
- tracking link expiry, revocation, and access metadata;
- limited public tracking page access information;
- route and ETA-related information where enabled.

Authenticated ride details no longer require embedded live map cards, but location updates can still be processed in the background and shared through dedicated tracking links.

### 4.9 Communications And Notifications Data

Deliivo may collect and process:

- in-app notification records;
- notification title, body, type, status, read/unread state, and deep link;
- email delivery metadata;
- SMS delivery metadata;
- Firebase device tokens or web push tokens where configured;
- socket connection/user event metadata;
- chat conversations and messages;
- support messages and admin notes.

Notifications may include ride route, date/time, actor, status, booking ID, ride ID, and links where appropriate. Deliivo should avoid placing sensitive payment data in notification payloads.

### 4.10 Dispute, Report, Rating, And Admin Data

Deliivo may collect:

- dispute reason;
- dispute description;
- dispute status;
- dispute evidence checklist;
- ride event evidence;
- GPS/no-GPS evidence indicators;
- admin evaluation;
- decision result;
- refund or payout decision;
- report reason;
- safety report details;
- rating score and text;
- admin action logs;
- admin search and review context where needed for audit.

### 4.11 Technical, Security, And Device Data

Deliivo may collect:

- IP address;
- device and browser information;
- request timestamps;
- logs;
- API errors;
- authentication events;
- session metadata;
- fraud and abuse signals;
- crash or diagnostic data where configured;
- cookie and local storage values, including language preference.

## 5. Sources Of Data

Deliivo receives data from:

- users directly;
- drivers publishing rides;
- riders booking rides;
- operational actions during ride day;
- payment providers such as Stripe;
- verification providers such as Veriff;
- maps providers such as Google Maps;
- notification providers such as Firebase, Twilio, and email providers;
- support and admin actions;
- automated jobs, queues, and reconciliation services;
- device/browser APIs such as geolocation where permission is granted.

## 6. How We Use Personal Data

Deliivo uses personal data to:

- create and secure accounts;
- authenticate users with OTP and tokens;
- onboard riders and drivers;
- maintain profiles and trust signals;
- support women-only ride eligibility and other preference filters;
- verify drivers, vehicles, and documents;
- publish rides;
- calculate route, segment, capacity, and pricing;
- allow riders to search and book rides;
- process payments and refunds;
- onboard drivers for payouts;
- calculate earnings, payout eligibility, and ledger entries;
- send booking, payment, ride-day, cancellation, dispute, and payout notifications;
- support chat and user communication;
- operate ride-day flows;
- process live tracking and tracking links;
- investigate no-shows, missed pickups, disputes, fraud, and safety reports;
- administer ratings and reputation;
- provide customer support;
- run admin operations;
- reconcile payments, refunds, payouts, and ledger entries;
- prevent fraud, abuse, unsafe behavior, and policy violations;
- comply with legal, accounting, tax, consumer, safety, and law enforcement obligations;
- improve product reliability, UX, and business operations.

## 7. Legal Bases Under GDPR

Depending on the activity, Deliivo may rely on:

### 7.1 Contract

Processing necessary to provide the platform, including account creation, ride publishing, booking, payments, ride-day operations, notifications, support, and dispute handling.

### 7.2 Legitimate Interests

Processing necessary for marketplace safety, fraud prevention, platform integrity, service improvement, admin operations, dispute evidence, reconciliation, ratings, abuse prevention, and business analytics, balanced against user rights.

### 7.3 Consent

Processing based on consent, such as optional browser push notifications, certain location permission prompts, marketing communications where applicable, and optional cookies where required.

### 7.4 Legal Obligation

Processing necessary for tax, accounting, payment, anti-fraud, consumer law, legal claims, law enforcement requests, and regulatory compliance.

### 7.5 Vital Interests Or Public Interest

In rare safety situations, Deliivo may process or disclose data to protect a person's vital interests or where required by law.

## 8. Special Category And Sensitive Data

Gender may be used for women-only ride safety controls. Gender can be sensitive depending on jurisdiction and context. Deliivo should process it only for clear safety, trust, eligibility, and marketplace purposes, with appropriate safeguards.

Driver license documents, verification documents, location data, safety reports, dispute evidence, and payment metadata may also be sensitive in practice even if not always legally classified as special category data.

Deliivo should avoid collecting special category data unless necessary and legally justified.

## 9. Location Data And Live Tracking

Deliivo may request location permission from drivers and riders for ride-day evidence and live tracking features.

Driver location may be collected during an active ride or when location sharing is started. Rider location may be collected for pickup-arrival, missed-pickup, drop-off, or dispute evidence where the rider chooses or permits it.

Location data may be used for:

- ride-day status;
- live tracking links;
- pickup and drop-off evidence;
- no-show and missed-pickup analysis;
- dispute resolution;
- safety and support;
- fraud prevention.

Tracking links should expose only minimal safe tracking information and should expire or be revocable.

Users should not share live tracking links with people they do not trust.

## 10. Payments And Financial Data

Deliivo uses payment providers such as Stripe to process card payments, store payment methods, handle refunds, connect driver payout accounts, and manage transfers.

Deliivo stores payment metadata needed to operate and reconcile the marketplace. Full card data is processed by Stripe or the relevant provider, not by Deliivo.

Financial data may be used for:

- booking payment;
- payment confirmation;
- refund handling;
- payout eligibility;
- payout batch processing;
- ledger entries;
- reconciliation;
- dispute settlement;
- fraud and chargeback handling;
- accounting and legal compliance.

## 11. Verification Providers

Deliivo may use external verification providers such as Veriff for driver license, identity, or document verification. Verification providers may process data under their own terms and privacy policies.

Deliivo may store verification status, provider identifiers, timestamps, and related metadata to determine driver eligibility and support audit needs.

## 12. Google Maps And Route Services

Deliivo may use Google Maps or similar providers for:

- address lookup;
- geocoding;
- route calculation;
- distance and duration estimates;
- place details;
- map or tracking-related functionality.

Address, coordinate, route, or request data may be sent to those providers where required to provide route features.

## 13. Notifications, Email, SMS, Push, And Chat

Deliivo may use in-app notifications, realtime sockets, Firebase, Twilio, email providers, and chat services to send service messages.

Service communications may include:

- authentication and OTP;
- booking request updates;
- payment status;
- driver approval or rejection;
- cancellation and refund updates;
- ride start;
- live tracking link;
- pickup/drop-off status;
- no-show and missed pickup;
- dispute status;
- payout status;
- support and policy notices.

Marketing messages should require opt-in where legally required. Service messages may be necessary to provide the platform.

## 14. Cookies, Local Storage, And Similar Technologies

Deliivo may use cookies, local storage, and similar technologies to:

- keep users signed in;
- store refresh/session-related state;
- remember language preference;
- secure requests;
- operate the web portal;
- measure performance where configured.

Optional analytics or marketing cookies should be documented and consent-managed before production launch where legally required.

## 15. When We Share Data

Deliivo may share data with:

- riders and drivers involved in the same ride;
- tracking link recipients through limited tracking pages;
- payment providers;
- payout and banking providers;
- verification providers;
- map providers;
- notification, SMS, and email providers;
- hosting, database, queue, storage, monitoring, and infrastructure providers;
- admin and support personnel;
- professional advisers;
- law enforcement, regulators, courts, or authorities where legally required;
- another company in connection with merger, acquisition, financing, or asset transfer, subject to legal safeguards.

### 15.1 Data Shared Between Riders And Drivers

Depending on the ride state, Deliivo may show:

- profile name or display name;
- profile photo;
- rating and ride counts;
- vehicle details;
- pickup/drop-off details;
- booking status;
- operational ride status;
- limited contact or communication channels;
- OTP-related pickup flow information;
- live tracking link or tracking status where appropriate.

Deliivo should avoid exposing unnecessary phone, payment, document, or sensitive identity data unless required for the service.

### 15.2 Data Shared With Admins

Authorized admins may access operational data required to support users, investigate issues, resolve disputes, process refunds, review payouts, and maintain platform integrity.

Admin access should be role-restricted and auditable.

## 16. International Transfers

Deliivo may use providers located outside the user's country or outside the EEA. Where personal data is transferred internationally, Deliivo should rely on appropriate safeguards, such as:

- adequacy decisions;
- Standard Contractual Clauses;
- data processing agreements;
- provider security and compliance commitments;
- other lawful transfer mechanisms.

Provider-specific transfer details should be documented before production launch.

## 17. Data Retention

Deliivo keeps personal data only as long as reasonably necessary for the purposes described in this Privacy Policy, unless a longer period is required by law.

Indicative retention categories:

- account data: while the account is active and for a limited period after closure;
- authentication logs: limited security retention;
- ride and booking records: retained for operational, safety, tax, accounting, dispute, and legal claim periods;
- payment and ledger metadata: retained for accounting, tax, reconciliation, chargeback, and legal requirements;
- payout records: retained for financial compliance and reconciliation;
- dispute and safety reports: retained for safety, audit, and legal claims;
- location updates: retained only as long as needed for live tracking, safety, dispute, and operational evidence;
- tracking links: expire or can be revoked, while limited metadata may be retained;
- messages and notifications: retained according to product and support needs;
- deleted account data: removed or anonymized unless retention is legally or operationally necessary.

Deliivo should define exact retention periods before production launch.

## 18. Security

Deliivo uses technical and organizational measures intended to protect personal data, such as:

- authentication and authorization controls;
- role-based admin access;
- token-based sessions;
- encrypted transport;
- payment provider tokenization;
- webhook signature verification;
- idempotent event handling where implemented;
- logging and reconciliation;
- restricted secret handling;
- environment separation for test and live modes;
- database and infrastructure controls.

No system is completely secure. Users should protect their account devices, email, phone, and login methods.

## 19. User Rights

Depending on applicable law, users may have rights to:

- access personal data;
- correct inaccurate data;
- delete data;
- restrict processing;
- object to processing;
- data portability;
- withdraw consent;
- complain to a supervisory authority;
- challenge automated decisions where applicable.

Requests can be sent to privacy@deliivo.com.

Deliivo may need to verify identity before responding. Some data may be retained where necessary for safety, disputes, fraud prevention, payments, accounting, legal claims, or compliance.

## 20. Account Deletion And Data Export

Deliivo may provide account deletion and GDPR export functionality through user or support workflows.

Deletion may not immediately remove:

- payment and ledger records;
- payout records;
- dispute records;
- ride and booking records needed for other users;
- safety reports;
- fraud-prevention records;
- legal, tax, accounting, or compliance records;
- anonymized or aggregated analytics.

Where possible, Deliivo may anonymize or minimize retained records.

## 21. Automated Decision-Making And Profiling

Deliivo may use automated checks for:

- booking capacity;
- payment state;
- booking expiry;
- payout eligibility;
- reconciliation issues;
- safety and fraud signals;
- notification delivery;
- search and matching logic;
- development/test-mode gating.

Deliivo currently expects admins to review sensitive dispute, safety, financial, and support decisions where required. If Deliivo introduces legally significant fully automated decisions, this policy should be updated.

## 22. Children

Deliivo is not intended for children below the legal age required to use ride-sharing, payment, or online marketplace services. The final minimum age should be confirmed by legal counsel for launch jurisdictions.

If Deliivo learns that it has collected data from a child unlawfully, it should delete or restrict that data as required by law.

## 23. Marketing And Analytics

Deliivo may send service communications without marketing consent where needed to operate the platform. Marketing communications, referral promotions, newsletters, or product updates should be sent only where permitted by law.

Analytics should be documented before launch, including provider, purpose, cookie behavior, retention, and opt-out options.

## 24. Business Transfers

If Deliivo is involved in a merger, acquisition, financing, restructuring, sale of assets, or similar transaction, personal data may be transferred as part of that transaction subject to appropriate safeguards and notices required by law.

## 25. Changes To This Privacy Policy

Deliivo may update this Privacy Policy. Material changes should be communicated by email, in-app notice, or other reasonable means where legally required.

The platform may store acceptance metadata for privacy policy version and timestamp where required for booking and compliance workflows.

## 26. Supervisory Authority

Users in the EU/EEA may have the right to lodge a complaint with their local data protection supervisory authority.

For an Estonia-headquartered company, the Estonian Data Protection Inspectorate may be relevant. Users may also contact the authority in their country of residence or where the issue occurred.

This section should be finalized after confirming the legal controller.

## 27. Contact

Privacy requests:

privacy@deliivo.com

Legal questions:

legal@deliivo.com

Support:

support@deliivo.com

General contact:

contact@deliivo.com

## 28. Publication Checklist

Before publishing this Privacy Policy, Deliivo should confirm:

- final controller legal name and address;
- DPO or privacy representative details, if required;
- final minimum age;
- final analytics and cookie providers;
- final retention schedule;
- final Stripe, Google Maps, Veriff, Firebase, Twilio, email, AWS, hosting, and monitoring provider list;
- final international transfer safeguards;
- final gender/women-only legal basis and safeguards;
- final location tracking retention and exposure rules;
- final public tracking link data minimization rules;
- final account deletion and export workflow;
- final admin audit and access policy;
- final marketing consent workflow;
- final supervisory authority language.
