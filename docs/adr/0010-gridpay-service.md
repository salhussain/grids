# 0010. GridPay is its own service

Status: accepted

## Context

Organisations can charge a fee on a form. Taking payments means merchants (with API keys), a payment page where people
type card details, and eventually a connection to a card processor. That is the part of the system with the strictest
security and compliance needs, and it should not share a process, a database or a deploy with the rest of the platform.

## Decision

Payments run as a separate service, `apps/pay` ("GridPay"), built like the identity service (ADR 0009):

- its own process (`PAY_PORT`, 4400) and its own database (`grids_pay`: merchants, payments);
- a private bearer token (`PAY_SERVICE_TOKEN`) used in both directions;
- it serves the payment page, takes the card (test cards only until a processor is connected), and encrypts merchants'
  credentials with its own key (`PAY_SECRET_KEY`);
- the platform API reaches it through the `PaymentGateway` port (`GridPayClient`): merchants, open a payment, ask how a
  payment stands. The API never sees a card number.

The platform keeps its own record of each payment (`payment` table) because it owns what comes after: the plan's fee
on the payment, the link to the form submission it paid for, and the invoices the fees go on (one per currency).

GridPay tells the platform when a payment ends (`POST /internal/payments/settled`), and keeps telling it until it
answers. The platform also asks GridPay when it needs to be sure (the person is back on the form, or a form is sent),
so a missed message never loses a payment.

## Consequences

- One more process and database to run; `pnpm db:migrate` migrates `grids_pay` when `DATABASE_URL_PAY` is set.
- Return addresses are checked by the platform (it knows the organisation's domains) before GridPay is given one.
- Live payments need the card processor's connection, to be written inside GridPay only.
