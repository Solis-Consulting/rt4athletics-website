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

  var schoolInput = form.querySelector("[name=school]");
  var hits = form.querySelector(".access-hits");
  var schoolTimer = null;
  schoolInput.addEventListener("input", function () {
    form.schoolId.value = "";
    form.conference.value = "";
    form.p4.value = "";
    clearTimeout(schoolTimer);
    var query = schoolInput.value.trim();
    if (query.length < 1) {
      hits.hidden = true;
      hits.innerHTML = "";
      return;
    }
    schoolTimer = setTimeout(function () {
      fetch(endpoint.replace(/\/api\/access$/, "/api/access/schools?q=" + encodeURIComponent(query)))
        .then(function (response) { return response.json(); })
        .then(function (rows) {
          hits.innerHTML = "";
          (rows || []).forEach(function (row) {
            var item = document.createElement("li");
            var button = document.createElement("button");
            button.type = "button";
            button.textContent = row.name + " · " + row.conference;
            button.addEventListener("click", function () {
              schoolInput.value = row.name;
              form.schoolId.value = row.id || "";
              form.conference.value = row.conference || "";
              form.p4.value = "yes";
              if (form.division) form.division.value = row.division || "D1";
              hits.hidden = true;
            });
            item.appendChild(button);
            hits.appendChild(item);
          });
          hits.hidden = !hits.children.length;
        })
        .catch(function () { hits.hidden = true; });
    }, 160);
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var error = form.querySelector(".access-error");
    if (error) error.hidden = true;
    var payload = {
      name: form.name.value.trim(),
      email: form.email.value.trim(),
      phone: form.phone.value.trim(),
      school: form.school.value.trim(),
      schoolId: form.schoolId.value,
      conference: form.conference.value,
      division: form.division.value,
      p4: form.schoolId.value ? "yes" : "no",
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
          division: payload.division,
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
