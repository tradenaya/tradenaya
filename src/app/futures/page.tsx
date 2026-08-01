"use client";

import { useState } from "react";


const markets = [
  {
    symbol: "BTC/USDT",
    price: "95000",
    change: "+2.45%",
    volume: "1.2B",
  },
  {
    symbol: "ETH/USDT",
    price: "3400",
    change: "-1.20%",
    volume: "520M",
  },
  {
    symbol: "SOL/USDT",
    price: "180",
    change: "+3.10%",
    volume: "300M",
  },
];


export default function FuturesPage() {

  const [search, setSearch] = useState("");


  const filteredMarkets = markets.filter((market) =>
    market.symbol
      .toLowerCase()
      .includes(search.toLowerCase())
  );


  return (

    <div className="min-h-screen bg-black text-white p-6">


      <h1 className="text-3xl font-bold mb-6">
        Futures Market
      </h1>



      <input
        type="text"
        placeholder="Search symbol..."
        value={search}
        onChange={(e)=>setSearch(e.target.value)}
        className="
          bg-zinc-900
          border
          border-zinc-700
          rounded
          px-4
          py-3
          w-full
          max-w-md
          mb-6
        "
      />



      <div className="bg-zinc-900 rounded-xl overflow-hidden">


        <div className="
          grid
          grid-cols-4
          p-4
          border-b
          border-zinc-700
          text-gray-400
        ">

          <span>Symbol</span>
          <span>Price</span>
          <span>24h Change</span>
          <span>Volume</span>

        </div>




        {
          filteredMarkets.map((market)=>(


            <div
              key={market.symbol}
              className="
                grid
                grid-cols-4
                p-4
                border-b
                border-zinc-800
                hover:bg-zinc-800
                cursor-pointer
              "
            >

              <span className="font-semibold">
                {market.symbol}
              </span>


              <span>
                ${market.price}
              </span>


              <span
                className={
                  market.change.startsWith("+")
                  ? "text-green-500"
                  : "text-red-500"
                }
              >
                {market.change}
              </span>


              <span>
                {market.volume}
              </span>


            </div>


          ))
        }


      </div>


    </div>

  );
}