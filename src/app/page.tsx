import Link from "next/link";

export const metadata = {
  title: "TRADENAYA — Trading ka naya tareeka",
  description:
    "Tradenaya — an automated crypto trading platform for India. Know what it is, how it works, and the process to follow.",
};

function ChartLine() {
  return (
    <svg viewBox="0 0 1600 900" preserveAspectRatio="none" aria-hidden="true">
      <polyline
        points="0,760 140,710 260,730 390,620 510,650 640,535 760,570 880,450 1000,490 1120,350 1240,390 1370,235 1600,90"
        fill="none"
        stroke="#c99a58"
        strokeWidth="2"
      />
      <g fill="#c99a58">
        <rect x="260" y="650" width="8" height="70" />
        <rect x="430" y="565" width="8" height="70" />
        <rect x="600" y="500" width="8" height="82" />
        <rect x="770" y="430" width="8" height="78" />
        <rect x="940" y="350" width="8" height="88" />
        <rect x="1110" y="270" width="8" height="85" />
        <rect x="1280" y="190" width="8" height="82" />
        <rect x="1450" y="105" width="8" height="96" />
      </g>
    </svg>
  );
}

const steps = [
  {
    num: "01",
    title: "Create your CoinSwitch account",
    body: "Sign up on CoinSwitch, complete KYC verification and deposit funds into your wallet. Tradenaya needs an active, funded exchange account to place trades on your behalf.",
  },
  {
    num: "02",
    title: "Create a Tradenaya account",
    body: "Register here with your email and password. No documents needed — a Tradenaya account is all you need to connect and manage your bots.",
  },
  {
    num: "03",
    title: "Add your exchange keys",
    body: "Securely connect CoinSwitch via API keys. Keys are encrypted and only used to place the trades you authorise — we never move your funds.",
  },
  {
    num: "04",
    title: "Choose or auto-select a bot",
    body: "Pick a strategy manually or let Tradenaya scan the market and auto-select the best opportunity across symbols, side and leverage — refreshed every few minutes.",
  },
  {
    num: "05",
    title: "Set capital & risk",
    body: "Decide how much of your wallet each trade should use. Our risk engine calculates position size, liquidation safety and drawdown limits for you.",
  },
  {
    num: "06",
    title: "Run and monitor",
    body: "Start the bot and it trades on your behalf, 24/7. Watch live positions, PnL, orders and analytics in the dashboard — pause or stop anytime.",
  },
];

const prerequisites = [
  {
    icon: "🪪",
    title: "Complete KYC on CoinSwitch",
    body: "Verify your identity on CoinSwitch — PAN card, Aadhaar and a selfie. Without KYC approval, futures trading and deposits will not be enabled on your account.",
    link: "https://coinswitch.co",
    linkLabel: "Start KYC on CoinSwitch",
  },
  {
    icon: "💳",
    title: "Deposit funds into your wallet",
    body: "Add funds to your CoinSwitch wallet via UPI, bank transfer (NEFT/IMPS/RTGS), or net banking. The balance you hold is what the bots will use for trading — deposit only what you are comfortable risking.",
    link: "https://coinswitch.co",
    linkLabel: "Deposit on CoinSwitch",
  },
  {
    icon: "🔗",
    title: "Generate API keys",
    body: "In CoinSwitch PRO → Profile → API Trading, generate a key pair. Copy both the API key and secret — they are shown only once. You will paste them into Tradenaya during the connect step.",
    link: "https://coinswitch.co/pro/profile?section=api-trading",
    linkLabel: "Go to CoinSwitch API Trading",
  },
];

const features = [
  {
    icon: "⊚",
    title: "Automated 24/7 trading",
    body: "Strategies keep scanning and trading even while you sleep. No screens to watch, no FOMO, no emotional decisions.",
  },
  {
    icon: "◈",
    title: "Smart auto-selection",
    body: "The engine scores fresh market data across every symbol and picks the setup with the strongest signal at the right moment.",
  },
  {
    icon: "⌁",
    title: "Built-in risk controls",
    body: "Live liquidation-distance checks, position-size rules and safety gates protect your capital on every single trade.",
  },
  {
    icon: "✦",
    title: "Live market intelligence",
    body: "Clean, real-time candle and ticker data powers every analysis cycle — so decisions are made on fresh data, never stale prices.",
  },
];

export default function Home() {
  return (
    <main className="landing">
      <style>{`
        .landing {
          --gold: #c99a58;
          --gold-soft: #dfb978;
          --bg: #070605;
          background: var(--bg);
          color: #eee5d8;
          font-family: "Cinzel", var(--font-cinzel), serif;
        }
        .landing * {
          box-sizing: border-box;
        }
        .landing a {
          text-decoration: none;
        }

        .hero {
          position: relative;
          width: 100%;
          height: 100vh;
          height: 100svh;
          overflow: hidden;
          background:
            radial-gradient(circle at 72% 52%, rgba(190,135,60,.12), transparent 32%),
            radial-gradient(ellipse at 18% 90%, rgba(120,80,30,.08), transparent 45%),
            linear-gradient(160deg, #0a0806 0%, #070605 55%, #050403 100%);
        }
        .hero::after {
          content: "";
          position: absolute;
          inset: 0;
          z-index: 3;
          pointer-events: none;
          box-shadow: inset 0 0 18vw rgba(0, 0, 0, .55);
        }
        .chart {
          position: absolute;
          inset: 0;
          opacity: .065;
          pointer-events: none;
        }
        .chart svg {
          width: 100%;
          height: 100%;
        }
        .ganesha {
          position: absolute;
          z-index: 2;
          right: -3vw;
          top: 50%;
          transform: translateY(-50%);
          width: min(42vw, 590px);
          max-height: 88vh;
          object-fit: contain;
          opacity: .62;
          mix-blend-mode: screen;
          filter: brightness(.72) saturate(.72) contrast(1.08) drop-shadow(0 0 32px rgba(201,154,88,.08));
          pointer-events: none;
        }
        .ganesha-glow {
          position: absolute;
          z-index: 1;
          width: 600px;
          height: 600px;
          right: 4%;
          top: 50%;
          transform: translateY(-50%);
          border-radius: 50%;
          background: radial-gradient(circle, rgba(201,154,88,.085) 0%, rgba(201,154,88,.025) 38%, transparent 70%);
        }
        .layout {
          position: relative;
          z-index: 6;
          width: min(1280px, 94vw);
          height: 100%;
          margin: auto;
          display: grid;
          grid-template-columns: 50% 50%;
          align-items: center;
        }
        .content {
          position: relative;
          z-index: 10;
          padding-left: 5vw;
          text-align: left;
        }
        .content > * {
          opacity: 0;
          transform: translateY(10px);
          animation: reveal .9s ease forwards;
        }
        .mantra {
          animation-delay: .05s;
        }
        .rule {
          animation-delay: .2s;
        }
        .logo {
          animation-delay: .3s;
        }
        .lbl-h {
          animation-delay: .4s;
        }
        .tagline {
          animation-delay: .55s;
        }
        .cta {
          animation-delay: .75s;
        }
        @keyframes reveal {
          to { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .content > * { animation: none; opacity: 1; transform: none; }
        }

        .mantra {
          font-family: var(--font-devanagari), "Noto Serif Devanagari", serif;
          color: var(--gold-soft);
          font-size: clamp(20px, 2.15vw, 29px);
          margin-bottom: 20px;
          text-shadow: 0 0 22px rgba(223, 185, 120, .25);
        }
        .rule {
          width: 210px;
          height: 1px;
          margin-bottom: 28px;
          background: linear-gradient(90deg, var(--gold), transparent);
        }
        .logo {
          width: 84px;
          display: block;
          margin-bottom: 18px;
          filter: invert(67%) sepia(31%) saturate(720%) hue-rotate(356deg) brightness(106%) drop-shadow(0 0 10px rgba(201,154,88,.35));
        }
        .lbl-h {
          margin: 0;
          font-family: var(--font-cinzel-decorative), "Cinzel Decorative", serif;
          font-size: clamp(42px, 5vw, 70px);
          font-weight: 400;
          letter-spacing: .13em;
          padding-left: .13em;
          background: linear-gradient(100deg, #f4e6cd 0%, #eee5d8 35%, var(--gold) 75%, #f4e6cd 100%);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
        }
        .tagline {
          margin-top: 10px;
          font-family: "Cinzel", var(--font-cinzel), serif;
          font-size: clamp(9px, .85vw, 12px);
          font-weight: 400;
          letter-spacing: .22em;
          color: rgba(218, 178, 117, .58);
          white-space: nowrap;
        }

        .cta {
          margin-top: 34px;
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .cta .line {
          width: 55px;
          height: 1px;
          background: linear-gradient(90deg, var(--gold), transparent);
        }
        .cta .diamond {
          width: 6px;
          height: 6px;
          border: 1px solid var(--gold);
          transform: rotate(45deg);
          animation: pulse 2.6s ease-in-out infinite;
        }
        .cta-btn {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          padding: 17px 42px;
          border: 1px solid rgba(201, 154, 88, .55);
          border-radius: 3px;
          background: linear-gradient(135deg, rgba(201,154,88,.16), rgba(201,154,88,.05));
          color: #f4e6cd;
          font-family: "Cinzel", var(--font-cinzel), serif;
          font-size: clamp(11px, 1vw, 13px);
          font-weight: 600;
          letter-spacing: .34em;
          text-transform: uppercase;
          transition: background .4s ease, box-shadow .4s ease, border-color .4s ease, color .4s ease;
        }
        .cta-btn:hover {
          background: linear-gradient(135deg, var(--gold), #a47209);
          border-color: var(--gold);
          color: #0a0806;
          box-shadow: 0 0 38px rgba(201, 154, 88, .45);
        }
        .cta-btn .diamond {
          animation: none;
          border-color: currentColor;
          opacity: .8;
        }
        @keyframes pulse {
          0%, 100% { opacity: .55; }
          50% { opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .cta .diamond { animation: none; }
        }

        .corner {
          position: absolute;
          z-index: 12;
          color: rgba(201, 154, 88, .30);
          font-size: 8px;
          letter-spacing: .28em;
          transition: color .4s ease;
        }
        .corner:hover {
          color: rgba(223, 185, 120, .65);
        }
        .est { top: 28px; left: 30px; }
        .bottom { right: 30px; bottom: 25px; }

        @media (max-width: 760px) {
          .layout {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%;
          }
          .content {
            width: 90vw;
            padding: 0;
            text-align: center;
            transform: translateY(-16vh);
          }
          .mantra { font-size: 20px; margin-bottom: 17px; }
          .rule {
            width: 145px;
            margin: 0 auto 21px;
            background: linear-gradient(90deg, transparent, var(--gold), transparent);
          }
          .logo { width: 72px; margin: 0 auto 15px; }
          .lbl-h {
            font-size: clamp(30px, 9vw, 45px);
            letter-spacing: .10em;
            padding-left: .10em;
          }
          .tagline { margin-top: 8px; font-size: 9px; letter-spacing: .14em; opacity: .78; }
          .cta {
            justify-content: center;
            margin-top: 26px;
          }
          .cta .line { width: 42px; }
          .cta-btn { padding: 15px 30px; letter-spacing: .24em; }
          .ganesha {
            width: auto;
            height: 48vh;
            max-width: 76vw;
            right: auto;
            left: 50%;
            top: auto;
            bottom: -1vh;
            transform: translateX(-50%);
            opacity: .48;
            mix-blend-mode: screen;
            filter: brightness(.62) saturate(.65) contrast(1.08) drop-shadow(0 0 28px rgba(201,154,88,.06));
          }
          .ganesha-glow {
            width: 100vw;
            height: 48vh;
            right: auto;
            left: 0;
            top: auto;
            bottom: -5vh;
            transform: none;
          }
          .est { top: 17px; left: 17px; font-size: 7px; }
          .bottom { right: 17px; bottom: 16px; font-size: 7px; }
        }
        @media (max-width: 390px) {
          .content { transform: translateY(-17vh); }
          .mantra { font-size: 17px; }
          .logo { width: 64px; }
          .lbl-h { font-size: 29px; }
          .cta { flex-wrap: wrap; gap: 8px; }
          .cta .line { display: none; }
          .cta-btn { padding: 13px 24px; }
          .ganesha {
            height: 45vh;
            max-width: 72vw;
            opacity: .43;
          }
        }

        .about {
          position: relative;
          z-index: 6;
          background:
            radial-gradient(circle at 12% 8%, rgba(190,135,60,.08), transparent 36%),
            linear-gradient(180deg, #050403 0%, #0a0806 100%);
          padding: 110px 0 130px;
        }
        .wrap {
          width: min(1080px, 90vw);
          margin: 0 auto;
        }
        .sec-head {
          text-align: center;
          margin-bottom: 34px;
        }
        .sec-kicker {
          font-family: var(--font-devanagari), "Noto Serif Devanagari", serif;
          color: var(--gold-soft);
          font-size: clamp(15px, 1.5vw, 19px);
          text-shadow: 0 0 22px rgba(223, 185, 120, .22);
        }
        .sec-title {
          margin: 14px 0 0;
          font-family: var(--font-cinzel-decorative), "Cinzel Decorative", serif;
          font-size: clamp(26px, 3vw, 40px);
          font-weight: 400;
          letter-spacing: .14em;
          padding-left: .14em;
          background: linear-gradient(100deg, #f4e6cd 0%, #eee5d8 40%, var(--gold) 80%, #f4e6cd 100%);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
        }
        .sec-rule {
          width: 110px;
          height: 1px;
          margin: 20px auto 0;
          background: linear-gradient(90deg, transparent, var(--gold), transparent);
        }
        .lead {
          max-width: 760px;
          margin: 26px auto 0;
          font-family: "Cinzel", var(--font-cinzel), serif;
          font-size: clamp(13px, 1.1vw, 15px);
          line-height: 1.9;
          letter-spacing: .06em;
          color: rgba(222, 210, 192, .82);
        }
        .lead b, .lead strong {
          color: var(--gold-soft);
          font-weight: 600;
        }

        .feat-grid {
          margin-top: 76px;
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 18px;
        }
        .feat {
          position: relative;
          padding: 34px 26px 30px;
          border: 1px solid rgba(201, 154, 88, .16);
          background: linear-gradient(160deg, rgba(201,154,88,.06), rgba(201,154,88,.015));
          border-radius: 4px;
          transition: border-color .4s ease, transform .4s ease, box-shadow .4s ease;
        }
        .feat:hover {
          border-color: rgba(201, 154, 88, .5);
          transform: translateY(-4px);
          box-shadow: 0 14px 40px rgba(0, 0, 0, .45), 0 0 30px rgba(201, 154, 88, .08);
        }
        .feat-icon {
          color: var(--gold);
          font-size: 24px;
          display: block;
          margin-bottom: 16px;
        }
        .feat h3 {
          margin: 0 0 10px;
          font-family: "Cinzel", var(--font-cinzel), serif;
          font-size: clamp(13px, 1vw, 15px);
          font-weight: 600;
          letter-spacing: .14em;
          color: #f4e6cd;
        }
        .feat p {
          margin: 0;
          font-size: 12px;
          line-height: 1.75;
          letter-spacing: .04em;
          color: rgba(206, 195, 175, .72);
        }

        .steps {
          margin-top: 110px;
        }
        .steps-list {
          margin-top: 54px;
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px 18px;
          padding: 0;
          list-style: none;
        }
        .step {
          position: relative;
          padding: 30px 26px 28px 70px;
          border: 1px solid rgba(201, 154, 88, .14);
          border-radius: 4px;
          background: linear-gradient(160deg, rgba(201,154,88,.05), rgba(201,154,88,.01));
          transition: border-color .4s ease, box-shadow .4s ease;
        }
        .step:hover {
          border-color: rgba(201, 154, 88, .45);
          box-shadow: 0 0 30px rgba(201, 154, 88, .07);
        }
        .step-num {
          position: absolute;
          left: 22px;
          top: 27px;
          font-family: var(--font-cinzel-decorative), "Cinzel Decorative", serif;
          font-size: 20px;
          color: var(--gold);
          opacity: .85;
        }
        .step-l {
          position: absolute;
          left: 22px;
          top: 58px;
          width: 1px;
          height: 36px;
          background: linear-gradient(180deg, var(--gold), transparent);
          opacity: .5;
        }
        .step h3 {
          margin: 0 0 8px;
          font-size: clamp(12px, .95vw, 14px);
          font-weight: 600;
          letter-spacing: .12em;
          color: #f4e6cd;
        }
        .step p {
          margin: 0;
          font-size: 12px;
          line-height: 1.7;
          letter-spacing: .04em;
          color: rgba(206, 195, 175, .72);
        }

        .final-cta {
          margin-top: 110px;
          text-align: center;
          border: 1px solid rgba(201, 154, 88, .22);
          background:
            radial-gradient(circle at 50% 0%, rgba(201,154,88,.12), transparent 60%),
            linear-gradient(180deg, rgba(201,154,88,.04), rgba(201,154,88,.01));
          padding: 64px 30px;
          border-radius: 6px;
        }
        .final-cta .mantra {
          margin-bottom: 16px;
        }
        .final-cta h2 {
          margin: 0;
          font-family: var(--font-cinzel-decorative), "Cinzel Decorative", serif;
          font-size: clamp(24px, 2.6vw, 34px);
          font-weight: 400;
          letter-spacing: .14em;
          padding-left: .14em;
          background: linear-gradient(100deg, #f4e6cd 0%, #eee5d8 40%, var(--gold) 80%, #f4e6cd 100%);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
        }
        .final-cta p {
          margin: 16px auto 0;
          max-width: 560px;
          font-size: 13px;
          line-height: 1.8;
          letter-spacing: .05em;
          color: rgba(206, 195, 175, .7);
        }
        .final-cta .cta-btn {
          margin-top: 34px;
        }

        footer.lf {
          position: relative;
          z-index: 6;
          background: #050403;
          border-top: 1px solid rgba(201, 154, 88, .12);
          padding: 26px 0;
          text-align: center;
        }
        footer.lf p {
          margin: 0;
          color: rgba(201, 154, 88, .34);
          font-size: 8px;
          letter-spacing: .28em;
        }

        @media (max-width: 900px) {
          .feat-grid { grid-template-columns: repeat(2, 1fr); }
          .prereq-grid { grid-template-columns: 1fr; }
          .steps-list { grid-template-columns: repeat(2, 1fr); }
        }
        @media (max-width: 560px) {
          .feat-grid { grid-template-columns: 1fr; }
          .steps-list { grid-template-columns: 1fr; }
          .about { padding: 80px 0 100px; }
        }

        .prereqs {
          margin-top: 110px;
        }
        .prereq-grid {
          margin-top: 54px;
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px 18px;
        }
        .prereq {
          position: relative;
          padding: 32px 26px 28px;
          border: 1px solid rgba(201, 154, 88, .14);
          border-radius: 4px;
          background: linear-gradient(160deg, rgba(201,154,88,.06), rgba(201,154,88,.015));
          transition: border-color .4s ease, box-shadow .4s ease, transform .4s ease;
        }
        .prereq:hover {
          border-color: rgba(201, 154, 88, .45);
          box-shadow: 0 14px 40px rgba(0, 0, 0, .35), 0 0 24px rgba(201, 154, 88, .06);
          transform: translateY(-3px);
        }
        .prereq-icon {
          color: var(--gold);
          font-size: 26px;
          display: block;
          margin-bottom: 16px;
        }
        .prereq h3 {
          margin: 0 0 10px;
          font-size: clamp(12px, .95vw, 14px);
          font-weight: 600;
          letter-spacing: .12em;
          color: #f4e6cd;
        }
        .prereq p {
          margin: 0;
          font-size: 12px;
          line-height: 1.75;
          letter-spacing: .04em;
          color: rgba(206, 195, 175, .72);
        }
        .prereq-link {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          margin-top: 18px;
          font-family: "Cinzel", var(--font-cinzel), serif;
          font-size: 10.5px;
          font-weight: 600;
          letter-spacing: .14em;
          color: var(--gold);
          transition: color .3s ease;
        }
        .prereq-link:hover {
          color: #f4e6cd;
        }
        .prereq-arrow {
          transition: transform .3s ease;
        }
        .prereq-link:hover .prereq-arrow {
          transform: translateX(3px);
        }
      `}</style>

      <section className="hero">
        <div className="chart">
          <ChartLine />
        </div>

        <div className="ganesha-glow" />

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="ganesha" src="/landing/ganesha.png" alt="" aria-hidden="true" />

        <div className="layout">
          <section className="content">
            <div className="mantra">॥ श्री गणेशाय नमः ॥</div>

            <div className="rule" />

            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="logo" src="/landing/logo.png" alt="Tradenaya" />

            <h1 className="lbl-h">TRADENAYA</h1>
            <div className="tagline">Trading ka naya tareeka</div>

            <div className="cta">
              <span className="line"></span>
              <span className="diamond"></span>
              <Link className="cta-btn" href="/signin">
                <span className="diamond"></span>
                Get Started
              </Link>
              <span className="diamond"></span>
              <span className="line"></span>
            </div>
          </section>
        </div>

        <div className="corner est">EST. 2026</div>
        <div className="corner bottom">TRADE • ANALYZE • GROW</div>
      </section>

      <section className="about">
        <div className="wrap">
          <div className="sec-head">
            <div className="sec-kicker">॥ क्या है त्रदेनया ॥</div>
            <h2 className="sec-title">WHAT IS TRADENAYA</h2>
            <div className="sec-rule" />
          </div>

          <p className="lead">
            <strong>Tradenaya</strong> — <em>trading ka naya tareeka</em> — is an automated crypto
            trading platform built for Indian traders. It watches the market continuously, scores
            every trading pair on fresh live data, and lets you run strategies that enter and exit
            positions for you. You bring the capital and the decision — Tradenaya brings the
            speed, discipline and 24/7 attention that manual trading cannot.
          </p>

          <div className="feat-grid">
            {features.map((f) => (
              <div className="feat" key={f.title}>
                <span className="feat-icon">{f.icon}</span>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </div>
            ))}
          </div>

          <div className="prereqs">
            <div className="sec-head">
              <div className="sec-kicker">॥ शुरू करने से पहले ॥</div>
              <h2 className="sec-title">BEFORE YOU BEGIN</h2>
              <div className="sec-rule" />
            </div>

            <p className="lead">
              Tradenaya works <strong>with CoinSwitch</strong>, not instead of it. Your exchange
              account is where your funds live and where trades actually execute — Tradenaya
              simply sends the instructions. Complete these three steps before connecting your
              API keys.
            </p>

            <div className="prereq-grid">
              {prerequisites.map((p) => (
                <div className="prereq" key={p.title}>
                  <span className="prereq-icon">{p.icon}</span>
                  <h3>{p.title}</h3>
                  <p>{p.body}</p>
                  <a
                    className="prereq-link"
                    href={p.link}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {p.linkLabel}
                    <span className="prereq-arrow">→</span>
                  </a>
                </div>
              ))}
            </div>
          </div>

          <div className="steps">
            <div className="sec-head">
              <div className="sec-kicker">॥ कैसे काम करता है ॥</div>
              <h2 className="sec-title">THE PROCESS TO FOLLOW</h2>
              <div className="sec-rule" />
            </div>

            <ol className="steps-list">
              {steps.map((s) => (
                <li className="step" key={s.num}>
                  <span className="step-num">{s.num}</span>
                  <span className="step-l" />
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </li>
              ))}
            </ol>
          </div>

          <div className="final-cta">
            <div className="mantra">॥ श्री गणेशाय नमः ॥</div>
            <h2>READY TO START?</h2>
            <p>
              Create your free account, connect your exchange in minutes, and let Tradenaya find
              the next opportunity while you watch it grow.
            </p>
            <Link className="cta-btn" href="/signin">
              <span className="diamond"></span>
              Get Started
            </Link>
          </div>
        </div>
      </section>

      <footer className="lf">
        <p>TRADENAYA • EST. 2026 • TRADE • ANALYZE • GROW</p>
      </footer>
    </main>
  );
}