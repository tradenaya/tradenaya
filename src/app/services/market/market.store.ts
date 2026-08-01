type MarketPrice = {
  symbol:string;
  price:number;
  updatedAt:number;
};


const prices:Record<string,MarketPrice> = {};


export function updateMarketPrice(
  symbol:string,
  price:number
){

  prices[symbol] = {
    symbol,
    price,
    updatedAt:Date.now()
  };


  console.log(
    "PRICE UPDATED",
    prices[symbol]
  );

}



export function getMarketPrices(){

  return prices;

}