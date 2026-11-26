# The Dry Cleaner — Master Backend API

NestJS RESTful API service for The Dry Cleaner platform.

## Features
- **Order State Machine**: 18 canonical states and transitions.
- **MongoDB Atlas**: ACID multi-document transactions & Outbox pattern.
- **Authentication**: Phone OTP and JWT auth with roles.
- **Local Storage Engine**: Server disk storage for proofs and images.
- **Payments**: Razorpay integration with webhook verification.

## Deployment on Render / Cloud
- **Build Command**: `npm install && npm run build`
- **Start Command**: `npm run start:prod`
- **Port**: `3000` (or `process.env.PORT`)
