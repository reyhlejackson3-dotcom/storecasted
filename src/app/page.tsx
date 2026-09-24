export default function Home() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "0 24px",
        maxWidth: 720,
        margin: "0 auto",
        fontFamily: "Arial, Helvetica, sans-serif",
        background: "#FFFBF5",
        color: "#17120E",
      }}
    >
      <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "#8A4406", margin: 0 }}>
        Coming soon
      </p>
      <h1 style={{ fontSize: "clamp(36px, 9vw, 60px)", lineHeight: 1.02, letterSpacing: "-.035em", margin: "12px 0 16px", fontWeight: 900 }}>
        You run your store. Storecasted watches it.
      </h1>
      <p style={{ fontSize: 17, color: "#6E6055", maxWidth: "48ch", margin: 0 }}>
        A short morning briefing on your Square store — what&apos;s running low, what&apos;s selling fast, and what needs you today.
      </p>
    </main>
  );
}
