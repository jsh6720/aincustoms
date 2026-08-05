# Role-Based Cargo Mail Routing Design

## Goal

Cargo mail recipients are configured once by role and reused consistently by every user-triggered request or schedule-change mail.

## Role Settings

- `ain_default`: AIN Customs operational recipients.
- `shipper_default`: shipper recipients.
- `destination_default`: delivery-destination recipients.

Existing feature-specific settings remain in `cargo_mail_settings`. They are not deleted and continue to act as compatibility fallbacks while the role settings are introduced.

## Routing Rules

### Request mails

Original-document receipt requests, import-declaration requests, and release requests use:

- To: `ain_default`
- CC: `shipper_default` + `destination_default` + requester email, when entered

### Schedule-change mails

Arrival schedule and inbound/warehouse schedule changes use:

- To: `shipper_default` + `destination_default`
- CC: `ain_default`

Saved role settings take priority. Existing feature settings and environment defaults are used only when the relevant role setting is absent.

## Arrival Schedule Mail

Subject format:

```text
[입항 스케줄 변경] 현대_<B/L> / <납품처>
```

The body names the full shipper and destination, then shows B/L, arrival date, and the free-time expiry date. The old honorific suffix `귀` is not used.

## Preview

Before a user-triggered mail is sent, the browser requests a server-generated preview. The preview displays the final To, CC, subject, and body. Confirming the preview performs the existing save-and-send operation; cancelling it sends nothing.

## Preservation

- Existing account, cargo, document, request, date, status, and feature-mail-setting rows are not reset or deleted.
- Existing effective recipient values remain visible in the administrator settings page.
- The local deployment mirror must match the homepage source after implementation.

