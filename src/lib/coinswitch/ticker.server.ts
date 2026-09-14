import { connect, StringCodec } from "nats.ws";


let started = false;


export async function startTicker() {


    if(started){
        return;
    }


    started = true;




    try {

        const nc = await connect({

            servers:
            "wss://pc-nats-prod.coinswitch.co",

            timeout:5000

        });




        const sc = StringCodec();


        const sub = nc.subscribe(
            "v1.f.ex1.public.futures.ticker.>"
        );




        for await(const msg of sub){


        }


    }
    catch(err){


        started=false;

    }

}