# SAP Integration

This document describes how to configure and test the minimal SAP integration added to the project.

Environment variables (see `.env.example`):

- `SAP_BASE_URL` — base URL of the SAP system (OData/REST endpoint).
- `SAP_USERNAME` — username for Basic auth (optional).
- `SAP_PASSWORD` — password for Basic auth (optional).

Endpoints added:

- `GET /api/sap/ping` — quick ping through backend to SAP base URL.
- `POST /api/sap/call` — proxy arbitrary calls to SAP. Request body:

```json
{
  "endpoint": "/sap/odata/...",