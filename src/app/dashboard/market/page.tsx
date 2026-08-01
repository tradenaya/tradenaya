"use client";

import { 
  useEffect, 
  useState, 
  useRef 
} from "react";
import { useRouter } from "next/navigation";

export default function MarketPage(){


  const [coins,setCoins] = useState<any[]>([]);

  const [filteredCoins,setFilteredCoins] = useState<any[]>([]);

  const [search,setSearch] = useState("");

  const [page,setPage] = useState(1);

  const [loading,setLoading] = useState(true);
const router = useRouter();
  const [error,setError] = useState("");



  const fetching = useRef(false);


  const coinsPerPage = 50;




  async function loadMarket(){


    // prevent duplicate requests
    if(fetching.current)
      return;



    fetching.current = true;



    try{


      setError("");



      const res = await fetch(
        "/api/coinswitch/futures/ticker",
        {
          cache:"no-store"
        }
      );



      const json = await res.json();



      console.log(
        "MARKET DATA",
        json
      );



      if(!json.success){

        throw new Error(
          json.message ||
          "Failed to fetch market"
        );

      }




      const list = Object.entries(
        json.data
      )
      .map(
        ([symbol,value]:any)=>({

          symbol,

          ...value

        })
      );



      setCoins(list);


      // apply existing search

setFilteredCoins(
  search
    ? list.filter(
        coin =>
          coin.symbol
          .toLowerCase()
          .includes(
            search.toLowerCase()
          )
      )
    : list
);



    }
    catch(err:any){


      console.log(
        "MARKET ERROR",
        err
      );


      setError(
        err.message
      );


    }
    finally{


      setLoading(false);


      fetching.current=false;


    }


  }





  useEffect(()=>{


    loadMarket();



    const interval =
      setInterval(
        loadMarket,
        15000
      );



    return ()=>{

      clearInterval(interval);

    };


  },[]);






  function handleSearch(
    value:string
  ){


    setSearch(value);


    setPage(1);



    if(!value){


      setFilteredCoins(
        coins
      );


      return;

    }



    const result =
      coins.filter(
        coin =>
          coin.symbol
          .toLowerCase()
          .includes(
            value.toLowerCase()
          )
      );



    setFilteredCoins(result);


  }






  const totalPages =
    Math.ceil(
      filteredCoins.length /
      coinsPerPage
    );




  const start =
    (page-1) *
    coinsPerPage;




  const currentCoins =
    filteredCoins.slice(
      start,
      start + coinsPerPage
    );





  return (

    <div className="
      p-6
      text-white
    ">


      <h1 className="
        text-2xl
        font-bold
        mb-5
      ">
        Futures Market
      </h1>




      <input

        value={search}

        onChange={
          e=>
          handleSearch(
            e.target.value
          )
        }

        placeholder="
          Search coin e.g BTCUSDT
        "

        className="
          border
          border-zinc-700
          bg-black
          rounded
          p-3
          w-full
          mb-5
        "

      />





      {
        error &&

        <div className="
          bg-red-900
          p-3
          rounded
          mb-4
        ">

          {error}

        </div>

      }





      {
        loading ?

        <p>
          Loading market...
        </p>


        :



        <div className="
          overflow-x-auto
        ">



        <table className="
          w-full
          border
          border-zinc-700
        ">



        <thead>


        <tr className="
          border
          border-zinc-700
        ">


          <th className="p-3">
            Symbol
          </th>


          <th className="p-3">
            Last Price
          </th>


          <th className="p-3">
            24h %
          </th>


          <th className="p-3">
            Volume
          </th>


          <th className="p-3">
            Funding
          </th>


        </tr>


        </thead>





        <tbody>


        {
          currentCoins.map(
            coin=>(


            <tr

              key={
                coin.symbol
              }

  onClick={() =>
    router.push(
      `/trade/${coin.symbol}`
    )
  }


  className="
    border
    border-zinc-700
    hover:bg-zinc-800
    hover:text-white
    transition
    cursor-pointer
  "

            >


              <td className="p-3">

                {coin.symbol}

              </td>




              <td className="p-3">

                {coin.last_price}

              </td>




              <td className="p-3">

                {coin.price_24h_pcnt}%

              </td>




              <td className="p-3">

                {coin.quote_asset_volume_24h}

              </td>




              <td className="p-3">

                {coin.funding_rate}

              </td>




            </tr>


            )

          )
        }


        </tbody>


        </table>



        </div>

      }






      {
        totalPages > 1 &&


        <div className="
          flex
          gap-2
          mt-5
          flex-wrap
        ">


        {
          Array.from(
            {
              length:totalPages
            }
          )
          .map(
            (_,index)=>{


              const pageNumber =
                index+1;


              return (

                <button


                  key={
                    pageNumber
                  }


                  onClick={
                    ()=>setPage(
                      pageNumber
                    )
                  }


                  className={`
                    px-3
                    py-1
                    rounded
                    border
                    border-zinc-700

                    ${
                      page===pageNumber
                      ?
                      "bg-card text-card-foreground"
                      :
                      "hover:bg-zinc-800"
                    }

                  `}


                >

                  {pageNumber}


                </button>

              )


            }
          )

        }


        </div>

      }



    </div>

  );


}