# AI-Powered Ticket Management System

## Problem

We receive hundreds of support emails daily. Our agents manually read, classify, and respond to each ticket - which is slow and leads to impersonal, canned reponses.

## Solution

Build a ticket management system that uses AI to automatically classify, respond to, and route support tickets - delivering faster, more personalised responses to students while freeing up agents for complex issues.

## Features

- Receive support emails and create tickets
- Auto-generate human-friendly responses using a knowledge base
- Ticket list wiht filtering and sorting
- Ticket detail view
- AI-powered ticket classification
- AI summaries
- AI-suggested replies
- User management (admin only)
- Dashboard to view and manage all tickets

## Ticket statuses

A ticket can be in one of three statuses:

- `open` — newly received or in progress
- `resolved` — agent has sent a reply that addresses the issue
- `closed` — no further action expected

## Categories

Each ticket belongs to exactly one category:

- General question
- Technical question
- Refund request

## Deployment & user setup

The system is deployed with a single admin user pre-provisioned. The admin signs in and creates additional agent accounts from the user management screen. There is no public sign-up; agents only exist if an admin creates them.
