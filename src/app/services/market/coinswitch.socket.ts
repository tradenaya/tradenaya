import { io } from "socket.io-client";


let socket: any = null;


export function startCoinSwitchSocket(coins: string[]) {


  if (socket) {
    console.log("Socket already running");
    return;
  }


  console.log("Creating CoinSwitch socket...");


  socket = io(
    "wss://ws.coinswitch.co/coinswitchx",
    {
      path: "/pro/realtime-rates-socket/spot",
      transports: ["websocket"],
    }
  );



  socket.on(
    "connect",
    () => {


      console.log(
        "Connected:",
        socket.id
      );


      coins.forEach(
        (coin) => {


          const pair = `${coin},INR`;


          socket.emit(
            "FETCH_TRADES_CS_PRO",
            {
              event: "subscribe",
              pair
            }
          );


          console.log(
            "Subscribed",
            pair
          );


        }
      );


    }
  );



socket.onAny((event:any, data:any)=>{

  console.log(
    "🔥 SOCKET EVENT RECEIVED:",
    event,
    data
  );

});



  socket.on(
    "disconnect",
    () => {

      console.log(
        "Socket disconnected"
      );

      socket = null;

    }
  );


}