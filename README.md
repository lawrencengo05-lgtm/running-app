# Running App

An AI-powered running coach and journal application built on AWS.

## Features

- Run logging — track distance, pace, time, and notes for every run
- AI coach — chat with a Claude-powered coach that knows your run history
- Stats dashboard — total distance, weekly volume, longest run, personal bests
- Charts — distance over time and pace trends
- Edit/delete past runs — fix mistakes, remove duplicates
- Dark mode — toggleable, persists across sessions
- Unit toggle — display in km or miles

## Architecture

- Frontend — React + Vite, deployed via S3 + CloudFront
- Backend — AWS Lambda (Node.js 24)
- API — Amazon API Gateway (HTTP API)
- Database — Amazon DynamoDB (on-demand)
- AI — Anthropic Claude API (Haiku 4.5)

## Local development

Backend setup:

    cd backend
    npm install

Frontend setup:

    cd frontend
    npm install
    npm run dev

## Deployment

Auto-deploys via GitHub Actions when changes are pushed to main.