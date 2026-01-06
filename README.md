# tomalia (Mercari-like prototype for Vietnam)

This is a **class-project prototype** of a fandom-focused C2C marketplace inspired by Mercari,
with additional "trust" features (Escrow concept, verification, seller tags, transaction screen).

## Tech
- Node.js + Express
- SQLite (local file DB)
- EJS templates (server-rendered pages)
- Multer uploads (photos)
- QRCode generation (prototype banking QR payload)

## Quick start
1) Install Node.js (LTS)
2) In this folder:
```bash
npm install
npm run dev
```
3) Open:
- http://localhost:10000

## Demo accounts (auto-seeded)
- demo_buyer / Password123!
- demo_seller / Password123!

## Key pages
- `/` Main page (suggested items + categories)
- `/register` Register
- `/login` Login
- `/sell` Upload item for sale
- `/items/:id` Item details (interest, buy, cart; seller view shows edit/discard)
- `/mypage` My Page (profile, selling/sold, purchases, interested, verification)
- `/notifications` Notifications
- `/orders/:orderId/transaction` Seller transaction screen (fee 6% after sold)

## Notes
- This prototype does not implement real payments.
- Security hardening (CSRF, rate limiting, production session secret, etc.) is not included.
