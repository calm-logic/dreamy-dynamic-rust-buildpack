// The root page: the app's own home (frontend/overrides/home/HomePage.vue) when
// the app has one, inside the shared shell; the shared dashboards when one is
// asked for (/?dashboard=<id>, as the header's Home menu opens them) or when the
// app has none. frontend/scripts/prepare.py wires this into the router.
import { defineAsyncComponent, h, Transition } from "vue";
import { useRoute } from "vue-router";
import "./kit.css";

function homeRoute(dashboards, home) {
  const Dashboards = defineAsyncComponent(dashboards);
  const Home = defineAsyncComponent(home);
  return {
    name: "AppHomeRoute",
    setup() {
      const route = useRoute();
      return () => {
        const shared = Boolean(route.query.dashboard || route.query.d);
        return h(Transition, { name: "app-fade", mode: "out-in" }, () => h(shared ? Dashboards : Home, { key: shared ? "dashboards" : "home" }));
      };
    },
  };
}

/** The admin's routes with the app's home page at "/". */
export function withHome(routes, home) {
  return routes.map((route) =>
    route.name !== "layout"
      ? route
      : {
          ...route,
          children: route.children.map((child) => (child.name === "home" ? { ...child, component: homeRoute(child.component, home) } : child)),
        }
  );
}
