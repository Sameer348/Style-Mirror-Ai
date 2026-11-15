# Claude AI Build Prompt — StyleMirror AI

You are a senior full-stack engineer and product designer. Build and improve the attached StyleMirror AI project into a production-ready virtual try-on platform. Preserve the existing working features and do not replace real integrations with fake success messages.

## Product goal
Users upload their own photo and a clothing product image to preview the garment on their body. Users can also try glasses using an uploaded selfie and live webcam. A 3D studio lets users inspect a rotatable avatar and, eventually, real garment/avatar assets.

## Required modules
1. Landing page and responsive dashboard.
2. Clothes AI try-on: person image + garment image, category selection (upper body/lower body/dresses), async job status, result preview, download, retry and error states.
3. Glasses photo try-on: accurate face landmark detection and alignment; multiple frame styles and adjustable fit.
4. Live glasses try-on: MediaPipe Face Landmarker, camera permission flow, mirrored preview, frame selection, stop-camera cleanup.
5. 3D studio: Three.js viewer, GLB/GLTF avatar and garment loading, orbit controls, lighting, responsive resize, model validation. Clearly distinguish a static 3D preview from physically accurate cloth simulation.
6. Backend: FastAPI, input validation, secure API keys, provider adapter, timeouts, clear errors, upload size limits, CORS, rate limiting, logging.
7. Database/auth: add Supabase Auth and private Storage, user-scoped try-on history, signed URLs, deletion controls. Never expose service-role keys in browser.
8. Privacy/security: explicit camera consent, no camera recording, clear image retention policy, consent before sending face photos to third-party AI, HTTPS, abuse prevention.
9. Testing: frontend component tests, backend endpoint tests, validation tests, and setup documentation.

## AI integration requirements
- Keep provider credentials server-side only.
- Implement an adapter interface so IDM-VTON/CatVTON or a hosted inference provider can be selected.
- Document the exact provider request/response schema and model license.
- Do not claim a try-on succeeded if the provider is not configured or fails.
- If provider returns a queued job, poll its status and show progress.
- Add an optional GPU self-hosting deployment guide only if model license and hardware requirements permit.

## Deliverables
- Complete source code with a clear folder structure.
- `.env.example` files with placeholders only.
- README with Windows/macOS/Linux setup and deployment.
- Database SQL migrations.
- API documentation and example curl commands.
- No hardcoded secrets, fake payment flow, or nonfunctional buttons.
- Run lint, type checks and tests; fix errors before completion.

Start by inspecting the existing repository. First give a short implementation plan, then implement in small verified stages. Ask me only when a real product or provider decision is blocking implementation. Prefer sensible defaults otherwise.
