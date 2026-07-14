/*
 * plain-intrinsic — client-side DCF engine.
 *
 * A faithful port of skills/dcf/scripts/dcf_calculator.py (FCFF methodology).
 * The static pages ship the *inputs* only; this script turns them into the
 * final valuation table in the browser. No market price, valuation only.
 */
(function (global) {
  "use strict";

  // ----------------------------------------------------------------- parsing
  function parseValue(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === "number") return value;
    if (typeof value === "string") {
      var v = value.trim().toUpperCase();
      var mult = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };
      var suffix = v.slice(-1);
      if (mult[suffix] !== undefined) {
        return parseFloat(v.slice(0, -1)) * mult[suffix];
      }
      return parseFloat(v);
    }
    return null;
  }

  // -------------------------------------------------------------- formatting
  function money(x, decimals) {
    if (x === null || x === undefined || isNaN(x)) return "N/A";
    if (decimals === undefined) decimals = 2;
    var ax = Math.abs(x);
    var units = [["T", 1e12], ["B", 1e9], ["M", 1e6], ["K", 1e3]];
    for (var i = 0; i < units.length; i++) {
      if (ax >= units[i][1]) {
        return "$" + (x / units[i][1]).toFixed(decimals) + units[i][0];
      }
    }
    return "$" + x.toFixed(0);
  }

  function pct(x) {
    if (x === null || x === undefined || isNaN(x)) return "N/A";
    return (x * 100).toFixed(2) + "%";
  }

  function price(x) {
    if (x === null || x === undefined || isNaN(x)) return "—";
    return "$" + x.toFixed(2);
  }

  // -------------------------------------------------------------------- WACC
  function calculateWacc(waccInputs, taxRate) {
    var rf = waccInputs.risk_free_rate;
    var erp = waccInputs.equity_risk_premium;
    var beta = waccInputs.beta;
    var rd = waccInputs.cost_of_debt;
    var wd = waccInputs.debt_weight;
    var we = waccInputs.equity_weight;
    var re = rf + beta * erp; // CAPM cost of equity
    var wacc = we * re + wd * rd * (1 - taxRate);
    return { wacc: wacc, costOfEquity: re };
  }

  // --------------------------------------------------------------- core DCF
  function calculateDcf(data) {
    var by = data.base_year;
    var a = data.assumptions;

    var baseRevenue = parseValue(by.revenue);
    var daPercent = by.da_percent;
    var nwcPercent = by.nwc_percent;

    var taxRate = a.tax_rate;
    var growthRates = a.growth_rates;
    var ebitMargins = a.ebit_margins;
    var capexPercent = a.capex_percent;
    if (capexPercent === undefined || capexPercent === null) {
      capexPercent = by.capex_percent; // legacy fallback
    }

    var terminalGrowth = data.terminal.growth_rate;

    var bs = data.balance_sheet;
    var cash = parseValue(bs.cash);
    var debt = parseValue(bs.debt);
    var shares = parseValue(bs.diluted_shares);

    var w = calculateWacc(data.wacc_inputs, taxRate);
    var wacc = w.wacc;

    var years = growthRates.length;
    var fcffs = [];
    var discountFactors = [];
    var pvFcffs = [];

    var prevRevenue = baseRevenue;
    var prevNwc = baseRevenue * nwcPercent;

    for (var i = 0; i < years; i++) {
      var revenue = prevRevenue * (1 + growthRates[i]);
      var ebit = revenue * ebitMargins[i];
      var nopat = ebit * (1 - taxRate);
      var da = revenue * daPercent;
      var capexRate = Array.isArray(capexPercent) ? capexPercent[i] : capexPercent;
      var capex = revenue * capexRate;
      var nwc = revenue * nwcPercent;
      var deltaNwc = nwc - prevNwc;
      var fcff = nopat + da - capex - deltaNwc;
      var df = 1 / Math.pow(1 + wacc, i + 1);

      fcffs.push(fcff);
      discountFactors.push(df);
      pvFcffs.push(fcff * df);

      prevRevenue = revenue;
      prevNwc = nwc;
    }

    var terminalFcff = fcffs[years - 1] * (1 + terminalGrowth);
    var terminalValue = terminalFcff / (wacc - terminalGrowth);
    var pvTerminal = terminalValue * discountFactors[years - 1];

    var sumPvFcff = pvFcffs.reduce(function (s, v) { return s + v; }, 0);
    var enterpriseValue = sumPvFcff + pvTerminal;
    var equityValue = enterpriseValue + cash - debt;
    var intrinsicPrice = equityValue / shares;

    return {
      years: years,
      wacc: wacc,
      costOfEquity: w.costOfEquity,
      terminalValue: terminalValue,
      pvTerminal: pvTerminal,
      sumPvFcff: sumPvFcff,
      enterpriseValue: enterpriseValue,
      equityValue: equityValue,
      intrinsicPrice: intrinsicPrice,
      cash: cash,
      debt: debt,
      shares: shares,
      terminalGrowth: terminalGrowth
    };
  }

  // --------------------------------------------------------------- scenarios
  function normalizeScenarios(rawScenarios) {
    if (!Array.isArray(rawScenarios) || rawScenarios.length === 0) {
      throw new Error("'scenarios' must be a non-empty list");
    }
    var scenarios = rawScenarios.map(function (s, idx) {
      if (typeof s !== "object" || s === null) {
        throw new Error("scenarios[" + idx + "] must be an object");
      }
      if (!("probability" in s)) {
        throw new Error("scenarios[" + idx + "] is missing 'probability'");
      }
      var p = Number(s.probability);
      if (isNaN(p)) throw new Error("scenarios[" + idx + "].probability must be a number");
      if (p < 0) throw new Error("scenarios[" + idx + "].probability cannot be negative");
      var copy = JSON.parse(JSON.stringify(s));
      copy.probability = p;
      return copy;
    });

    var total = scenarios.reduce(function (s, x) { return s + x.probability; }, 0);
    if (total <= 0) throw new Error("Scenario probability sum must be > 0");

    // Accept either decimal probabilities (sum 1.0) or percentages (sum 100).
    if (total > 1.0001) {
      if (Math.abs(total - 100.0) <= 0.1) {
        scenarios.forEach(function (s) { s.probability /= 100.0; });
        total = scenarios.reduce(function (s, x) { return s + x.probability; }, 0);
      } else {
        throw new Error("Scenario probabilities must sum to 1.0 (or 100)");
      }
    }
    if (Math.abs(total - 1.0) > 0.001) {
      throw new Error("Scenario probabilities must sum to 1.0; got " + total.toFixed(4));
    }
    return scenarios;
  }

  function buildScenarioData(baseData, scenario) {
    var scenarioData = JSON.parse(JSON.stringify(baseData));
    delete scenarioData.scenarios;
    ["base_year", "assumptions", "wacc_inputs", "terminal", "balance_sheet"].forEach(function (key) {
      if (key in scenario) {
        var base = scenarioData[key];
        var override = scenario[key];
        if (base && typeof base === "object" && !Array.isArray(base) &&
            override && typeof override === "object" && !Array.isArray(override)) {
          var merged = JSON.parse(JSON.stringify(base));
          for (var k in override) { if (override.hasOwnProperty(k)) merged[k] = override[k]; }
          scenarioData[key] = merged;
        } else {
          scenarioData[key] = override;
        }
      }
    });
    return scenarioData;
  }

  function calculateProbabilityWeighted(data) {
    var scenarios = normalizeScenarios(data.scenarios);
    var results = scenarios.map(function (scenario, idx) {
      var name = scenario.name || "Scenario " + (idx + 1);
      var scenarioData = buildScenarioData(data, scenario);
      var result = calculateDcf(scenarioData);
      return {
        name: name,
        probability: scenario.probability,
        results: result,
        contribution: result.intrinsicPrice * scenario.probability
      };
    });
    var weighted = results.reduce(function (s, r) { return s + r.contribution; }, 0);
    return { scenarioResults: results, weightedPrice: weighted };
  }

  /**
   * Normalize any input doc into { method, scenarios[], intrinsic }.
   * Works for both multi-scenario and single-scenario input files.
   */
  function evaluate(data) {
    var scenarios, intrinsic, method;
    if (data.scenarios) {
      var pw = calculateProbabilityWeighted(data);
      scenarios = pw.scenarioResults.map(function (item) {
        return {
          name: item.name,
          probability: item.probability,
          wacc: item.results.wacc,
          terminalGrowth: item.results.terminalGrowth,
          intrinsicPrice: item.results.intrinsicPrice,
          contribution: item.contribution
        };
      });
      intrinsic = pw.weightedPrice;
      method = "DCF — FCFF, probability-weighted scenarios";
    } else {
      var r = calculateDcf(data);
      scenarios = [{
        name: "Base",
        probability: 1.0,
        wacc: r.wacc,
        terminalGrowth: r.terminalGrowth,
        intrinsicPrice: r.intrinsicPrice,
        contribution: r.intrinsicPrice
      }];
      intrinsic = r.intrinsicPrice;
      method = "DCF — FCFF, single scenario";
    }
    return { method: method, scenarios: scenarios, intrinsic: intrinsic };
  }

  // ------------------------------------------------------------- DOM helpers
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function renderReport(data) {
    var evald = evaluate(data);

    var methodEl = document.getElementById("dcf-method");
    if (methodEl) methodEl.textContent = evald.method;

    var intrinsicEl = document.getElementById("dcf-intrinsic");
    if (intrinsicEl) intrinsicEl.textContent = price(evald.intrinsic);

    // Scenario rows
    var tbody = document.getElementById("dcf-scenario-rows");
    if (tbody) {
      tbody.innerHTML = "";
      evald.scenarios.forEach(function (s) {
        var tr = document.createElement("tr");
        tr.appendChild(el("td", "name", s.name));
        tr.appendChild(el("td", "num", pct(s.probability)));
        tr.appendChild(el("td", "num", pct(s.wacc)));
        tr.appendChild(el("td", "num", pct(s.terminalGrowth)));
        tr.appendChild(el("td", "num strong", price(s.intrinsicPrice)));
        tr.appendChild(el("td", "num", price(s.contribution)));
        tbody.appendChild(tr);
      });
    }
    var weightedEl = document.getElementById("dcf-weighted");
    if (weightedEl) weightedEl.textContent = price(evald.intrinsic);

    // Key inputs (financials the valuation rests on)
    var kbody = document.getElementById("dcf-key-inputs");
    if (kbody) {
      kbody.innerHTML = "";
      var bs = data.balance_sheet || {};
      var rows = [];
      var baseRev = data.base_year && data.base_year.revenue;
      if (baseRev) rows.push(["Base-year revenue", money(parseValue(baseRev))]);
      if (bs.cash !== undefined) rows.push(["Cash", money(parseValue(bs.cash))]);
      if (bs.debt !== undefined) rows.push(["Debt", money(parseValue(bs.debt))]);
      if (bs.diluted_shares !== undefined) {
        rows.push(["Diluted shares", (parseValue(bs.diluted_shares) / 1e9).toFixed(3) + "B"]);
      }
      rows.forEach(function (r) {
        var tr = document.createElement("tr");
        tr.appendChild(el("td", null, r[0]));
        tr.appendChild(el("td", "num", r[1]));
        kbody.appendChild(tr);
      });
    }
    return evald;
  }

  function renderIndex(entries) {
    var mount = document.getElementById("dcf-index");
    if (!mount) return;

    // Group by symbol, newest date first.
    var bySymbol = {};
    entries.forEach(function (e) {
      (bySymbol[e.symbol] = bySymbol[e.symbol] || []).push(e);
    });
    Object.keys(bySymbol).forEach(function (sym) {
      bySymbol[sym].sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    });

    mount.innerHTML = "";
    if (entries.length === 0) {
      mount.appendChild(el("p", "empty", "No reports yet."));
      return;
    }

    Object.keys(bySymbol).sort().forEach(function (sym) {
      var section = el("section", "sym-group");
      section.appendChild(el("h2", null, sym));
      bySymbol[sym].forEach(function (e) {
        var a = document.createElement("a");
        a.className = "report-row";
        a.href = e.path;
        a.appendChild(el("span", "rr-date", e.date));
        a.appendChild(el("span", "rr-method", e.method || ""));
        var metric = el("span", "rr-metric", "intrinsic ");
        var b = el("b");
        try {
          b.textContent = price(evaluate(e.input).intrinsic);
        } catch (err) {
          b.textContent = "—";
        }
        metric.appendChild(b);
        a.appendChild(metric);
        section.appendChild(a);
      });
      mount.appendChild(section);
    });
  }

  // ------------------------------------------------------------------ public
  var DCF = {
    parseValue: parseValue,
    money: money,
    pct: pct,
    price: price,
    calculateWacc: calculateWacc,
    calculateDcf: calculateDcf,
    calculateProbabilityWeighted: calculateProbabilityWeighted,
    evaluate: evaluate,
    renderReport: renderReport,
    renderIndex: renderIndex
  };

  // Auto-init when embedded data is present on the page.
  function boot() {
    var inputEl = document.getElementById("dcf-input");
    if (inputEl) {
      try {
        renderReport(JSON.parse(inputEl.textContent));
      } catch (err) {
        var box = document.getElementById("dcf-intrinsic");
        if (box) box.textContent = "error";
        if (global.console) console.error("DCF report render failed:", err);
      }
    }
    var manifestEl = document.getElementById("dcf-manifest");
    if (manifestEl) {
      try {
        renderIndex(JSON.parse(manifestEl.textContent));
      } catch (err) {
        if (global.console) console.error("DCF index render failed:", err);
      }
    }
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = DCF; // Node (used by the validation harness)
  } else {
    global.DCF = DCF;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot);
    } else {
      boot();
    }
  }
})(typeof window !== "undefined" ? window : this);
