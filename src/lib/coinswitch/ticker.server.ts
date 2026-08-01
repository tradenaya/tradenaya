import { connect, StringCodec } from "nats.ws";


let started = false;


export async function startTicker() {


    if(started){
        console.log("Ticker already running");
        return;
    }


    started = true;


    console.log("Connecting CoinSwitch NATS ticker");


    try {

        const nc = await connect({

            servers:
            "wss://pc-nats-prod.coinswitch.co",

            timeout:5000

        });


        console.log("✅ NATS CONNECTED");


        const sc = StringCodec();


        const sub = nc.subscribe(
            "v1.f.ex1.public.futures.ticker.>"
        );


        console.log(
            "✅ TICKER SUBSCRIBED"
        );


        for await(const msg of sub){

            console.log(
                "🔥 TICKER",
                sc.decode(msg.data)
            );

        }


    }
    catch(err){

        console.log(
            "❌ NATS FAILED",
            err
        );

        started=false;

    }

}