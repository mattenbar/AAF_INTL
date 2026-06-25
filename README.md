# AAF INTL Cloudinary AI Demo

Demo web app for uploading an image to Cloudinary cloud `doxfstysv` with the Cloudinary Upload Widget, then running:

- Cloudinary AI Vision General analysis
- Cloudinary AI Vision Prompt Tagging
- Cloudinary AI Content Analysis models

## Setup

1. Copy `.env.example` to `.env`.
2. Add your Cloudinary API key and API secret to `.env`.
3. Keep `CLOUDINARY_UPLOAD_PRESET=unsigned_upload_preset`, or change it if your Cloudinary preset name changes.
4. Start the app:

```bash
npm start
```

Open `http://localhost:5174`.

## Notes

- Browser uploads use Cloudinary's Upload Widget with the unsigned preset configured in `server.js` / `.env`.
- Analyze API calls are proxied through `server.js` so the API secret is not exposed to browser code.
- Uploaded assets are sent to the Analyze API by delivery URL instead of asset ID to avoid asset-id access restrictions from widget uploads.
- Vision AI tags can be filtered with the confidence threshold slider and applied back to the uploaded asset with **Update Image Tags**.
- AI Vision Prompt Tagging lets you add up to 10 tag names and definitions, analyze the image against those definitions, and apply matched tags back to the asset.
- Captioning results can be written to Cloudinary contextual metadata keys `caption` and `alt` with **Add Caption + Alt Text**.
- The Cloudinary Analyze API requires the relevant add-on subscriptions for AI Vision and AI Content Analysis.
