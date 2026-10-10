import { bootstrap, startApi } from "./server";

await bootstrap();
const { url } = startApi();
console.log(`rxsolve api on ${url}  (ws: ${url.replace("http", "ws")}/ws/live)`);
