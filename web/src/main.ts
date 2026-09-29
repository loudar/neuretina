import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";
import { eventStream } from "./lib/events.svelte";

const target = document.getElementById("app");
if (!target) throw new Error("#app element not found");

eventStream.start();

export default mount(App, { target });
