import { io } from "socket.io-client";


let socket: any = null;


export function startCoinSwitchSocket(coins: string[]) {


  if (socket) {
    return;
  }




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




        }
      );


    }
  );



socket.onAny((event:any, data:any)=>{


});



  socket.on(
    "disconnect",
    () => {


      socket = null;

    }
  );


}