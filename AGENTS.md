# AGENTS.md

## Project
This is a fork/custom working copy of ReportPortal service-ui.

## Goal
Add a StreamPulse-powered "Observability & KPIs" tab to the ReportPortal test item detail/log page.

## Product Direction
ReportPortal remains the primary UI.
StreamPulse is the external observability backend.

## Existing ReportPortal Sections To Preserve
Do not remove or break:
- Stack Trace
- All Logs
- Attachments
- Item Details
- History of Actions

## New UI Addition
Add only one new tab/section:
- Observability & KPIs

Inside Observability & KPIs, render collapsible/foldable sections:
- Performance Session Summary
- AI RCA & Insights
- Network Intelligence
- Functional KPIs
- App KPIs
- Device KPIs
- API KPIs
- QoE KPIs
- QoS KPIs
- AV KPIs
- Stability KPIs
- Localization KPIs
- Accessibility KPIs
- Artifacts & Evidence
- History / Regression

## API Contract
The tab should call StreamPulse API:
GET /api/v1/reportportal/items/{rp_item_id}/observability

The StreamPulse base URL should be configurable.

## UI Rules
- Keep ReportPortal look and feel.
- Do not build a separate StreamPulse dashboard here.
- Do not add many tabs.
- Hide empty KPI sections.
- Auto-expand warning/failing sections.
- RCA must show category, confidence, evidence, slow API/URL/CDN, reasoning, owner, and recommended action.

## Scope
Do not build Appium automation framework collectors here.
This repo is UI-only.
