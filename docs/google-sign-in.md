# Google Sign-In configuration

Deliivo uses Google Identity Services on the web and verifies the returned ID token on the backend.

## Google Cloud Console

1. Create an OAuth 2.0 Client ID with application type **Web application**.
2. Add the production frontend domain under **Authorized JavaScript origins**, for example `https://deliivo-webapp.vercel.app`.
3. Add local development origins such as `http://localhost:3001` and the Docker web origin if used.
4. A redirect URI is not required for this ID-token button flow.

## Environment variables

Set the same OAuth Web Client ID in both deployments:

- Frontend/Vercel: `NEXT_PUBLIC_GOOGLE_CLIENT_ID`
- Backend/Railway: `GOOGLE_CLIENT_ID`

Redeploy both services after changing these values because the frontend value is embedded at build time.

The backend accepts only Google-verified email addresses, links existing accounts by verified email, and routes new users through onboarding.
