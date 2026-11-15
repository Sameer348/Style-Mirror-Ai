export const metadata = { title: "Privacy & data | StyleMirror AI" };

export default function PrivacyPage() {
  return (
    <article className="panel prose">
      <h2>Privacy &amp; data handling</h2>
      <p className="muted">
        Plain-language summary of how StyleMirror handles your images. Operators: adapt this to your jurisdiction and
        have it reviewed before launch.
      </p>

      <h3>Clothes AI try-on</h3>
      <ul>
        <li>Your photo and the garment image are sent to our server and then to the configured third-party AI provider only after you tick the consent box.</li>
        <li>Before forwarding, images are resized and re-encoded, which removes metadata such as GPS location.</li>
        <li>Input photos are held in server memory only while the job runs and are discarded afterwards. They are never written to our storage.</li>
        <li>Unsaved results are kept in server memory for up to 30 minutes so your browser can fetch them, then discarded.</li>
        <li>The AI provider processes images under its own terms and retention policy. Check the provider listed in the consent text.</li>
      </ul>

      <h3>Saved history (signed-in users)</h3>
      <ul>
        <li>Results are saved only if you choose &ldquo;Save the result&rdquo;. They live in a private storage bucket that only your account can access.</li>
        <li>Images are shown through signed links that expire after about an hour.</li>
        <li>Saved results are deleted automatically after the retention period shown in the studio (default 30 days), or immediately when you delete them on the History page. &ldquo;Delete all my data&rdquo; removes every saved result.</li>
        <li>Deleting your account removes all of your history rows.</li>
      </ul>

      <h3>Glasses try-on and the live camera</h3>
      <ul>
        <li>Face detection runs entirely in your browser with MediaPipe. Selfies and camera frames are never uploaded.</li>
        <li>The camera starts only after you agree to the consent prompt and grant browser permission. It is never recorded and stops when you press Stop or leave the tab.</li>
        <li>The browser downloads the face-detection model file from Google&apos;s model CDN. No images are sent to it.</li>
      </ul>

      <h3>3D studio</h3>
      <ul>
        <li>Uploaded GLB/GLTF models are opened locally in your browser and never uploaded.</li>
      </ul>

      <h3>Abuse prevention</h3>
      <ul>
        <li>Only upload photos of yourself, or of people who have given you permission. Users must be 18+ or have a guardian&apos;s permission.</li>
        <li>Requests are rate-limited. Logs record request metadata (path, status, timing) but never image contents or access tokens.</li>
      </ul>
    </article>
  );
}
