# CRUZO AI Product UI Final (EN)

## 1. Product and Goal
Cruzo AI is a service that helps users send timely, personalized birthday cards.

Primary flow:
1. See who has a birthday today.
2. Generate message text and visual.
3. Approve and send.
4. If sending fails, retry quickly.

## 2. Final Navigation Structure
Main navigation (fixed, no duplicates):
1. Dashboard
2. Contacts
3. Generate
4. Integrations
5. Settings

Rules:
- No separate "Sending" tab.
- No separate "Creative Studio" tab (it is included in Generate).

## 3. Dashboard Screen
Purpose: daily operational home screen.

Blocks:
- `Today`: birthdays for the selected date.
- `Needs Action`: draft / approved / failed.
- `Quick Actions`: Generate, Approve, Send now, Retry.
- `Recent Sends`: latest sent/failed with error reasons.

Key actions:
- Generate a card for a contact.
- Approve a draft.
- Send manually.
- Retry after failed.

States:
- Empty: no birthdays today.
- Error: clear reason + "Retry" action.

## 4. Contacts Screen
Purpose: manage people and data quality.

Blocks:
- Contacts table: name, email, birthday_date, relationship, tone, source.
- Search and filters.
- Create/Edit form.

Key actions:
- Create / Edit / Delete.
- Quick jump to Generate for a selected contact.

States:
- Empty: hint to add the first contact.
- Validation: inline form errors.

## 5. Generate Screen
Purpose: single workspace for message and visual generation.

Screen structure:
- Left column: input parameters.
  - contact
  - tone
  - language
  - maxWords
  - channel (for preview)
- Right column: output.
  - subject
  - text
  - visual preview
  - action buttons

Key actions:
- Generate message
- Generate visual
- Edit subject/text
- Save draft
- Approve
- Send now (if approved)

States:
- Draft / Approved / Sent / Failed are always visible.
- On failed, show exact reason and Retry button.

## 6. Integrations Screen
Purpose: connect channels and monitor their state.

Blocks:
- Channels: Email, Telegram, WhatsApp, Instagram, Facebook.
- Channel status: connected / disconnected / not_implemented.
- Latest channel errors.

Key actions:
- Connect / Reconnect.
- Test channel (where available).

Principle:
- If a channel is not implemented, show Not Implemented explicitly (no hidden errors).

## 7. Settings Screen
Purpose: system and user configuration.

Blocks:
- Profile and timezone.
- Generation defaults: language, tone, maxWords.
- Security: access revocation, data deletion.

Key actions:
- Save settings.
- Reset defaults.

## 8. UX Principles (Updated)
1. Simplicity: minimum screens and entities.
2. No duplicates: one generation area (Generate).
3. Speed: minimum clicks to send.
4. Transparency: status and error are always visible.
5. Control: sending is explicit and understandable.
6. Safety: idempotency and predictable status transitions.

## 9. Mapping to Current Backend
Current manual backend covers the required scope:
- Contacts CRUD
- Birthdays today
- Generate / Edit / Approve
- Send now / Retry / Mark sent
- Status transitions + idempotency

This allows building the UI without changing core architecture.

## 10. Next Implementation Steps
1. Align the current `/manual` UI to this 5-section structure.
2. Make Dashboard the default screen.
3. Keep the full creation flow inside Generate (text + visual in one place).
4. Add Integrations and Settings in the same visual language.
5. After stabilization: polishing and mobile optimization.

## 11. Out of Scope for Now
- No extra sidebar sections.
- No separate "send center".
- Do not split Generate into multiple navigation tabs.
