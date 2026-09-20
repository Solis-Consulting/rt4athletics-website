(function () {
  const MEASUREMENT_ID = "G-DT31HYYEZ9";
  const PLACEHOLDER = /^G-X+$/i;
  const configured = /^G-[A-Z0-9]+$/i.test(MEASUREMENT_ID) && !PLACEHOLDER.test(MEASUREMENT_ID);

  const params = new URLSearchParams(window.location.search);
  const debug =
    params.has("debug_mode") ||
    params.has("ga_debug") ||
    /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);

  window.dataLayer = window.dataLayer || [];
  window.gtag =
    window.gtag ||
    function () {
      window.dataLayer.push(arguments);
    };

  if (configured) {
    const loader = document.createElement("script");
    loader.async = true;
    loader.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(MEASUREMENT_ID);
    document.head.appendChild(loader);

    window.gtag("js", new Date());
    window.gtag("config", MEASUREMENT_ID, {
      anonymize_ip: true,
      debug_mode: debug,
      send_page_view: true,
    });
  }

  const pagePath = window.location.pathname || "/";

  const articleSlug = function () {
    const marked = document.querySelector("[data-article-slug]");
    if (marked && marked.getAttribute("data-article-slug")) {
      return marked.getAttribute("data-article-slug");
    }
    const match = pagePath.match(/\/insights\/([^/]+)\.html$/);
    return match ? match[1] : "";
  };

  const ctaType = function (el) {
    const name = (el.getAttribute("data-cta") || "").toLowerCase();
    const href = (el.getAttribute("href") || "").toLowerCase();
    if (name === "sample-report" || href.indexOf("sample%20report") !== -1 || href.indexOf("sample report") !== -1) {
      return "sample";
    }
    if (name.indexOf("insight") !== -1) return "walkthrough";
    if (href.indexOf("mailto:access@rt4athletics.com") === 0) return "walkthrough";
    return name || "other";
  };

  const send = function (name, extra) {
    const payload = Object.assign(
      {
        page_path: pagePath,
        transport_type: "beacon",
      },
      extra || {}
    );
    window.gtag("event", name, payload);
  };

  const onReady = function (fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  };

  onReady(function () {
    const slug = articleSlug();
    if (slug) {
      send("insight_open", { article_slug: slug });
    }

    document.addEventListener("click", function (event) {
      const cta = event.target.closest("[data-cta]");
      if (cta) {
        const location = cta.getAttribute("data-cta") || "";
        const type = ctaType(cta);
        send("cta_click", {
          cta_location: location,
          cta_type: type,
        });

        if (type === "sample") {
          send("sample_request", { cta_location: location });
        } else if (type === "walkthrough") {
          send("walkthrough_request", { cta_location: location });
        }

        if (location === "insights-demo" && slug) {
          send("insight_cta_click", {
            article_slug: slug,
            cta_type: type,
          });
        }
      }

      const shot = event.target.closest("[data-school][data-surface]");
      if (shot && shot.tagName === "IMG") {
        send("product_image_click", {
          school: shot.getAttribute("data-school") || "",
          surface: shot.getAttribute("data-surface") || "",
        });
      }
    });
  });
})();
