import { mount } from "svelte";
import "highlight.js/styles/atom-one-dark.css";
import "./app.css";
import App from "./App.svelte";

const target = document.getElementById("app");
if (!target) throw new Error("#app element not found");

export default mount(App, { target });
