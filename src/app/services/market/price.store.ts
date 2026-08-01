type PriceData = {
  price: number;
  time: number;
};


const prices: Record<string, PriceData> = {};


export function updatePrice(
  symbol: string,
  price: number
) {

  prices[symbol] = {
    price,
    time: Date.now()
  };

}



export function getPrice(
  symbol: string
) {

  return prices[symbol];

}



export function getAllPrices() {

  return prices;

}