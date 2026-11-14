(function () {
  var form = document.getElementById("access-form");
  if (!form) return;
  var endpoint = "https://rt4athletics-crm-production.up.railway.app/api/access";
  var titles = { walkthrough: "Request a walkthrough", sample: "Ask for a sample" };

  function openForm(intent) {
    form.hidden = false;
    form.classList.remove("is-open");
    void form.offsetWidth;
    form.classList.add("is-open");
    form.intent.value = intent;
    var title = form.querySelector(".access-intent");
    if (title) title.textContent = titles[intent] || titles.walkthrough;
    var name = form.querySelector("[name=name]");
    if (name) name.focus();
  }

  document.querySelectorAll("[data-open-access]").forEach(function (button) {
    button.addEventListener("click", function () {
      openForm(button.getAttribute("data-intent") || "walkthrough");
    });
  });

  if (form.hasAttribute("data-open")) openForm(form.intent.value || "walkthrough");

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var error = form.querySelector(".access-error");
    if (error) error.hidden = true;
    var payload = {
      name: form.name.value.trim(),
      email: form.email.value.trim(),
      phone: form.phone.value.trim(),
      p4: form.p4.value,
      intent: form.intent.value || "walkthrough",
      page: location.pathname || "/"
    };
    var button = form.querySelector("[type=submit]");
    button.disabled = true;
    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (response) {
      if (!response.ok) throw new Error("save");
      return response.json();
    }).then(function () {
      if (window.gtag) {
        window.gtag("event", "lead_submit", {
          intent: payload.intent,
          p4: payload.p4,
          transport_type: "beacon"
        });
      }
      form.querySelector(".access-fields").hidden = true;
      form.querySelector(".access-done").hidden = false;
    }).catch(function () {
      button.disabled = false;
      if (error) error.hidden = false;
    });
  });
})();
