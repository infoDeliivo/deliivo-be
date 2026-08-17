# Referral And Wallet Rewards Flow Diagram

This diagram shows how Deliivo handles configurable referral rewards, ride milestone rewards, wallet balances, and Stripe Connect payout movement.

```mermaid
flowchart TD
    A[Admin creates reward campaign] --> B{Audience}
    B -->|Rider| C[Rider campaign active]
    B -->|Driver| D[Driver campaign active]
    B -->|Both| C
    B -->|Both| D

    C --> E[User performs action]
    D --> E

    E --> F{Trigger type}
    F -->|Referral| G[Check referred user completion]
    F -->|Ride completion| H[Count completed rides]
    F -->|Booking completion| I[Count completed bookings]
    F -->|Publish completion| J[Count published and completed rides]

    G --> K{Eligible?}
    H --> K
    I --> K
    J --> K

    K -->|No| L[Store pending progress]
    K -->|Yes| M[Create reward grant]

    M --> N{Reward type}
    N -->|Wallet credit| O[Add wallet credit]
    N -->|Payout bonus| P[Add payout bonus liability]

    O --> Q[Wallet balance updates]
    P --> R[Payout eligibility job]
    R --> S[Add bonus item to payout batch]
    S --> T{Stripe platform balance enough?}
    T -->|Yes| U[Transfer funds via Stripe Connect]
    T -->|No| V[Mark pending funds or failed retryable]
    V --> W[Admin tops up platform balance]
    W --> R
    U --> X[Mark payout paid]

    Q --> Y[Rider uses credit at checkout]
    Y --> Z{Does credit reduce rider payment below driver receivable?}
    Z -->|No| AA[Charge rider normally with credit applied]
    Z -->|Yes| AB[Record Deliivo subsidy liability]
    AA --> AC[Booking confirmed]
    AB --> AC

    AC --> AD[Ride or booking completion event]
    AD --> AE[Eligibility worker rechecks campaign rules]
    AE --> M

    M --> AF[Admin and support can view audit trail]
    L --> AF
    O --> AF
    P --> AF
    V --> AF
    X --> AF

    AF --> AG[Admin can pause, expire, void, manually grant, or retry]
```

## Sequence View

```mermaid
sequenceDiagram
    autonumber
    actor Admin
    actor Rider
    actor Driver
    participant App
    participant Rewards as Reward Engine
    participant Wallet
    participant Ledger
    participant Payouts
    participant Stripe

    Admin->>App: Create campaign and configure threshold / amount
    App->>Rewards: Store campaign rules

    Rider->>App: Complete qualifying booking or referral action
    App->>Rewards: Emit completion event
    Rewards->>Wallet: Create rider credit grant
    Rewards->>Ledger: Record reward and audit trail

    Driver->>App: Complete qualifying ride or referral action
    App->>Rewards: Emit completion event
    Rewards->>Ledger: Create driver reward grant
    Rewards->>Wallet: Mark bonus as payout-eligible

    App->>Wallet: Show wallet balance and reward history
    Rider->>App: Apply credit at checkout
    App->>Ledger: Record applied credit and any subsidy

    Payouts->>Ledger: Collect eligible ride earnings and bonus items
    Payouts->>Stripe: Create transfer from platform balance
    alt Balance sufficient
        Stripe-->>Payouts: Transfer succeeded
        Payouts->>Ledger: Mark payout paid
    else Balance insufficient
        Stripe-->>Payouts: Transfer failed
        Payouts->>Ledger: Mark pending funds / retryable
        Admin->>App: Top up platform balance and retry
    end
```

