"use client";

import { useState } from "react";
import { useEffect } from "react";
import { startCoinSwitchSocket } from "@/app/services/market/coinswitch.socket";

export default function DashboardPage() {
  const [loading, setLoading] = useState(false);
  const [portfolio, setPortfolio] = useState<any[]>([]);

  async function loadPortfolio() {
    try {
      setLoading(true);

      const res = await fetch("/api/coinswitch/portfolio");

      const data = await res.json();

      setPortfolio(data.data.data);
    } catch (error) {
      console.log(error);
    } finally {
      setLoading(false);
    }
  }

useEffect(()=>{

    async function getPrice(){

        const res = await fetch(
            "/api/coinswitch/ticker"
        );

        const data = await res.json();


        console.log(
            "PRICE DATA",
            data
        );

    }


    getPrice();


},[]);

  return (
    <div className="p-6 bg-[var(--background)] text-[var(--foreground)]">
      <h1 className="text-3xl font-bold mb-8">Dashboard</h1>
      {/* <button

onClick={async()=>{

 const res = await fetch(
   "/api/coinswitch/socket",
   {
    method:"POST"
   }
 );

 const data = await res.json();

 console.log(data);

}}

className="
bg-green-600
text-white
px-5
py-3
rounded-lg
"

>
Start Live Prices
</button> */}
      <button onClick={loadPortfolio} className="px-5 py-3 rounded-lg" style={{ backgroundColor: "var(--primary)", color: "var(--primary-foreground)" }}>
        {loading ? "Loading..." : "Load Portfolio"}
      </button>

      <div className="mt-8 grid gap-4">
        {portfolio.map((coin) => (
          <div
            key={coin.currency}
            className="
border
rounded-xl
p-5
"
          >
            
            <h2 className="text-xl font-bold">{coin.name}</h2>

            <p>Symbol: {coin.currency}</p>

            <p>
              Balance:
              {coin.main_balance}
            </p>

            <p>Invested: ₹{Number(coin.invested_value).toFixed(2)}</p>

            <p>Current: ₹{Number(coin.current_value).toFixed(2)}</p>

            <p>
              P/L: ₹
              {(
                Number(coin.current_value) - Number(coin.invested_value)
              ).toFixed(2)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
