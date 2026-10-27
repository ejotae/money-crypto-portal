
const API_KEY = "6454c70599e3cb1f597f4e47f6154aa3f5600154c548a762aaa884e71862ed21"; //this is supposed to be kept private
const currencies = {
    EURUSD: { name: "EUR to USD", color: "#eb5146" },
    BTC: { name: "Bitcoin (BTC)", color: "#f7931a", coinId: "bitcoin" },
    DOGE: { name: "Dogecoin (DOGE)", color: "#c2a633", coinId: "dogecoin" },
    ETH: { name: "Ethereum (ETH)", color: "#627eea", coinId: "ethereum" }
};

let monthsToShow = 240;
let nextChartNumber = 1;
let selectedChartId = "chart-0";
const fiatRates = {};
const dataCache = {};
const charts = {};

// Helper function to easily get HTML elements by their ID
function $(id) {
    return document.getElementById(id);
}

const today = new Date();
const todayString = today.toISOString().slice(0, 10); // Gets "YYYY-MM-DD"

window.addEventListener("DOMContentLoaded", startApp);

async function startApp() {
    bindEvents();
    $("buyDate").max = todayString;
    setStatus("Loading exchange-rate history…");
    
    await loadFiatData();
    
    if (dataCache.EURUSD !== undefined) {
        await renderChart("chart-0", "EURUSD");
        setStatus("Exchange-rate data loaded. Drop a currency onto a chart to compare it.");
    }
}

function bindEvents() {
    $("btn-6m").addEventListener("click", function() { setTimeframe(6, "btn-6m"); });
    $("btn-10y").addEventListener("click", function() { setTimeframe(120, "btn-10y"); });
    $("btn-20y").addEventListener("click", function() { setTimeframe(240, "btn-20y"); });
    $("btn-add-chart").addEventListener("click", addChart);
    $("btn-download").addEventListener("click", downloadSelectedChart);
    $("btn-share-x").addEventListener("click", function() { shareChart("x"); });
    $("btn-share-reddit").addEventListener("click", function() { shareChart("reddit"); });
    $("btn-calculate").addEventListener("click", calculatePortfolio);
    $("btn-quick-convert").addEventListener("click", quickConvert);

    const colorSelect = $("currencyColorSelect");
    const colorInput = $("chartColor");
    
    colorSelect.addEventListener("change", function() {
        let selectedCurrency = colorSelect.value;
        colorInput.value = currencies[selectedCurrency].color;
    });
    
    colorInput.addEventListener("input", function() {
        let selectedCurrency = colorSelect.value;
        currencies[selectedCurrency].color = colorInput.value;
        
        // Update all charts that use this currency
        for (let id in charts) {
            let chart = charts[id];
            if (chart.currencies.indexOf(selectedCurrency) !== -1) {
                renderChart(id, chart.currencies);
            }
        }
    });

    let dragItems = document.querySelectorAll(".drag-item");
    for (let i = 0; i < dragItems.length; i++) {
        let item = dragItems[i];
        item.addEventListener("dragstart", function(event) {
            event.dataTransfer.setData("text/plain", item.dataset.currency);
        });
    }

    bindDropzone($("wrapper-chart-0"), "chart-0");
}

function setStatus(message) {
    $("data-info-box").textContent = message;
}

async function fetchJson(url) {
    const response = await fetch(url);
    if (response.ok === false) {
        throw new Error("Request failed");
    }
    const data = await response.json();
    if (data.Response === "Error" || data.error) {
        throw new Error("The data service returned an error.");
    }
    return data;
}

// Data source 1: Frankfurter API
async function loadFiatData() {
    try {
        let startYear = today.getFullYear() - 20;
        let start = startYear + "-01-01";
        let end = todayString;
        
        let data = await fetchJson("https://api.frankfurter.dev/v1/" + start + ".." + end + "?to=USD");
        let groups = {};
        
        // Group daily rates into months
        for (let date in data.rates) {
            let dailyRates = data.rates[date];
            if (typeof dailyRates.USD === "number") {
                let month = date.slice(0, 7); // Gets "YYYY-MM"
                if (groups[month] === undefined) {
                    groups[month] = [];
                }
                groups[month].push(dailyRates.USD);
            }
        }

        let labels = Object.keys(groups).sort();
        let values = [];
        
        // Calculate the monthly average
        for (let i = 0; i < labels.length; i++) {
            let month = labels[i];
            let monthValues = groups[month];
            
            let sum = 0;
            for (let j = 0; j < monthValues.length; j++) {
                sum = sum + monthValues[j];
            }
            
            let average = sum / monthValues.length;
            fiatRates[month] = average;
            
            let formattedValue = Number(average.toFixed(4));
            values.push(formattedValue);
        }
        
        dataCache.EURUSD = {
            labels: labels,
            values: values,
            title: "Monthly average: USD for 1 EUR",
            unit: "USD per EUR"
        };
    } catch (error) {
        setStatus("Could not load exchange-rate history. Check your connection.");
    }
}

// Data source 2: CryptoCompare API
async function loadCryptoData(currency) {
    if (dataCache[currency] !== undefined) {
        return dataCache[currency];
    }
    
    let keyString = "";
    if (API_KEY !== "") {
        keyString = "&api_key=" + encodeURIComponent(API_KEY);
    }
    
    let url = "https://min-api.cryptocompare.com/data/v2/histoday?fsym=" + currency + "&tsym=USD&allData=true" + keyString;
    let response = await fetchJson(url);
    let dailyRows = response.Data.Data;
    
    let monthlyUsd = {};
    
    // Get the closing price for each month
    for (let i = 0; i < dailyRows.length; i++) {
        let row = dailyRows[i];
        if (row.close > 0) {
            // Convert timestamp to YYYY-MM
            let dateObj = new Date(row.time * 1000);
            let month = dateObj.toISOString().slice(0, 7);
            monthlyUsd[month] = row.close; 
        }
    }

    let allMonths = Object.keys(monthlyUsd);
    let labels = [];
    let values = [];
    
    // Only keep months where we have both crypto data AND fiat data
    for (let i = 0; i < allMonths.length; i++) {
        let month = allMonths[i];
        if (fiatRates[month] !== undefined) {
            labels.push(month);
        }
    }
    labels.sort();
    
    // Convert USD crypto price to EUR using our fiat data
    for (let i = 0; i < labels.length; i++) {
        let month = labels[i];
        let cryptoUsdPrice = monthlyUsd[month];
        let fiatExchangeRate = fiatRates[month];
        
        let euroPrice = cryptoUsdPrice / fiatExchangeRate;
        values.push(Number(euroPrice.toFixed(4)));
    }
    
    dataCache[currency] = {
        labels: labels,
        values: values,
        title: currencies[currency].name + " monthly closing price in EUR",
        unit: "EUR"
    };
    
    return dataCache[currency];
}

async function getCurrencyData(currency) {
    if (currency === "EURUSD") {
        return dataCache.EURUSD;
    } else {
        return await loadCryptoData(currency);
    }
}

async function renderChart(chartId, selectedCurrencies) {
    let container = $(chartId);
    if (container === null) return;

    // Keep the old one-currency call working for the first chart.
    let currenciesToShow = Array.isArray(selectedCurrencies) ? selectedCurrencies : [selectedCurrencies];
    let previousChart = charts[chartId];
    if (previousChart !== undefined && Array.isArray(selectedCurrencies) === false) {
        if (previousChart.currencies.indexOf(selectedCurrencies) === -1) {
            previousChart.currencies.push(selectedCurrencies);
        }
        currenciesToShow = previousChart.currencies;
    }

    if (currenciesToShow.length === 0) return;
    if (previousChart !== undefined && previousChart.pointListener !== undefined) {
        container.removeEventListener("data-select", previousChart.pointListener);
    }
    container.innerHTML = "";
    setStatus("Loading chart data…");

    try {
        let series = [];
        for (let i = 0; i < currenciesToShow.length; i++) {
            let currency = currenciesToShow[i];
            let data = await getCurrencyData(currency);
            series.push({ currency: currency, data: data });
        }

        // Use months every selected currency has so the lines line up.
        let labels = series[0].data.labels.filter(function(month) {
            for (let i = 1; i < series.length; i++) {
                if (series[i].data.labels.indexOf(month) === -1) return false;
            }
            return true;
        }).slice(-monthsToShow);

        let datasets = [];
        let colors = [];
        for (let i = 0; i < series.length; i++) {
            let item = series[i];
            let values = [];
            for (let j = 0; j < labels.length; j++) {
                let valueIndex = item.data.labels.indexOf(labels[j]);
                values.push(item.data.values[valueIndex]);
            }
            datasets.push({ name: currencies[item.currency].name, values: values });
            colors.push(currencies[item.currency].color);
        }

        let chart = new frappe.Chart("#" + chartId, {
            title: "Monthly comparison",
            data: { labels: labels, datasets: datasets },
            type: "line",
            height: 300,
            colors: colors,
            lineOptions: { hideDots: 0, regionFill: 1 },
            axisOptions: { xAxisMode: "tick", xIsSeries: true },
            isNavigable: true
        });

        charts[chartId] = {
            instance: chart,
            currencies: currenciesToShow.slice(),
            labels: labels,
            series: series,
            pointListener: null
        };

        setStatus("Chart loaded. Select a point to see the monthly values for each currency.");

        function showSelectedPoint(eventObj) {
            let index = 0;
            if (eventObj !== undefined) {
                if (eventObj.index !== undefined) {
                    index = eventObj.index;
                } else if (eventObj.detail !== undefined && eventObj.detail.index !== undefined) {
                    index = eventObj.detail.index;
                }
            }

            if (labels[index] !== undefined) {
                let details = [];
                for (let i = 0; i < series.length; i++) {
                    let valueIndex = series[i].data.labels.indexOf(labels[index]);
                    let value = series[i].data.values[valueIndex];
                    details.push(currencies[series[i].currency].name + ": " + value + " " + series[i].data.unit);
                }
                setStatus(labels[index] + " | " + details.join(" | "));
            }
        }

        charts[chartId].pointListener = showSelectedPoint;
        container.addEventListener("data-select", showSelectedPoint);
    } catch (error) {
        container.textContent = "Could not load this chart.";
        setStatus("Unable to load chart. Try again later.");
    }
}

function showPointDetails(currency, month, value, data) {
    let message = currencies[currency].name + " | Month: " + month + " | Value: " + value;
    
    if (currency === "EURUSD") {
        message = message + " USD per EUR. This is the monthly average exchange rate.";
        message = message + " Data source: Frankfurter.";
    } else {
        message = message + " EUR per coin.";
        if (fiatRates[month] !== undefined) {
            let usdPrice = value * fiatRates[month];
            message = message + " Approximate USD price: $" + usdPrice.toFixed(2) + ".";
        }
        message = message + " Data source: CryptoCompare combined with Frankfurter.";
    }
    
    setStatus(message);
}

function setTimeframe(months, buttonId) {
    monthsToShow = months;
    
    let buttons = document.querySelectorAll("#btn-6m, #btn-10y, #btn-20y");
    for (let i = 0; i < buttons.length; i++) {
        buttons[i].classList.remove("active");
    }
    
    $(buttonId).classList.add("active");
    
    for (let id in charts) {
        let chart = charts[id];
        renderChart(id, chart.currencies);
    }
}

function addChart() {
    let number = nextChartNumber;
    nextChartNumber = nextChartNumber + 1;
    let chartId = "chart-" + number;
    
    let wrapper = document.createElement("section");
    wrapper.className = "chart-wrapper";
    wrapper.id = "wrapper-" + chartId;

    let header = document.createElement("div");
    header.className = "chart-header";
    
    let heading = document.createElement("span");
    heading.textContent = "Chart " + (number + 1);
    
    let removeBtn = document.createElement("button");
    removeBtn.className = "btn";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", function() {
        delete charts[chartId];
        wrapper.remove();
        if (selectedChartId === chartId) {
            selectedChartId = "chart-0";
        }
        
        // FIX: Make remaining charts expand to fill the newly freed space
        setTimeout(function() {
            window.dispatchEvent(new Event("resize"));
        }, 50);
    });
    
    header.appendChild(heading);
    header.appendChild(removeBtn);
    
    let chartBox = document.createElement("div");
    chartBox.className = "frappe-chart-box";
    chartBox.id = chartId;
    
    wrapper.appendChild(header);
    wrapper.appendChild(chartBox);
    
    let currentWrapper = $("wrapper-" + selectedChartId);
    if (currentWrapper !== null && currentWrapper.parentNode === $("chart-container")) {
        currentWrapper.after(wrapper);
    } else {
        $("chart-container").appendChild(wrapper);
    }
    bindDropzone(wrapper, chartId);
    chartBox.textContent = "Drop a currency here to start this chart.";
    selectedChartId = chartId;
    
    // FIX: Make existing charts shrink to fit their new smaller containers
    setTimeout(function() {
        window.dispatchEvent(new Event("resize"));
    }, 50);
}

function bindDropzone(wrapper, chartId) {
    wrapper.addEventListener("click", function() { 
        selectedChartId = chartId; 
    });
    
    wrapper.addEventListener("dragover", function(event) {
        event.preventDefault();
        wrapper.classList.add("drag-over");
    });
    
    wrapper.addEventListener("dragleave", function(event) {
        if (wrapper.contains(event.relatedTarget) === false) {
            wrapper.classList.remove("drag-over");
        }
    });
    
    wrapper.addEventListener("drop", function(event) {
        event.preventDefault();
        wrapper.classList.remove("drag-over");
        let currency = event.dataTransfer.getData("text/plain");
        if (currencies[currency] !== undefined) {
            let chart = charts[chartId];
            let selectedCurrencies = chart === undefined ? [] : chart.currencies.slice();
            if (selectedCurrencies.indexOf(currency) === -1) {
                selectedCurrencies.push(currency);
                $("currencyColorSelect").value = currency;
                $("chartColor").value = currencies[currency].color;
                renderChart(chartId, selectedCurrencies);
            } else {
                setStatus(currencies[currency].name + " is already on this chart.");
            }
        }
    });
}

function downloadSelectedChart() {
    let chart = charts[selectedChartId];
    let wrapper = $(selectedChartId);
    if (wrapper === null) return;
    
    let svg = wrapper.querySelector("svg");
    if (chart === undefined || svg === null) {
        setStatus("Select a chart before downloading.");
        return;
    }
    
    let copy = svg.cloneNode(true);
    copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    
    let xmlString = new XMLSerializer().serializeToString(copy);
    let blob = new Blob([xmlString], { type: "image/svg+xml;charset=utf-8" });
    let url = URL.createObjectURL(blob);
    
    let link = document.createElement("a");
    link.href = url;
    link.download = chart.currencies.join("-") + "-chart.svg";
    link.click();
    
    URL.revokeObjectURL(url);
}

// Data source 3: CoinGecko Live Prices
async function getLivePrices() {
    let url = "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,dogecoin,ethereum&vs_currencies=eur,usd";
    return await fetchJson(url);
}

async function quickConvert() {
    let amount = Number($("quickAmount").value);
    let currency = $("quickCrypto").value;
    let output = $("quickConvertResult");
    
    if (amount < 0) {
        output.textContent = "Enter a valid amount.";
        return;
    }
    
    output.textContent = "Getting current prices…";
    try {
        let prices = await getLivePrices();
        let id = currencies[currency].coinId;
        
        if (prices[id] !== undefined) {
            let currentEur = prices[id].eur;
            let currentUsd = prices[id].usd;
            let totalEur = amount * currentEur;
            let totalUsd = amount * currentUsd;
            
            output.textContent = amount + " " + currency + " = €" + totalEur.toFixed(2) + " ($" + totalUsd.toFixed(2) + ").";
        }
    } catch (error) {
        output.textContent = "Could not get live prices.";
    }
}

async function calculatePortfolio() {
    let date = $("buyDate").value;
    let amount = Number($("buyAmount").value);
    let currency = $("cryptoSelect").value;
    let output = $("portfolioResult");
    
    if (date === "" || amount <= 0) {
        output.textContent = "Enter a purchase date and a positive amount.";
        return;
    }
    if (date > todayString) {
        output.textContent = "Date cannot be in the future.";
        return;
    }

    output.textContent = "Calculating…";
    
    try {
        let keyString = "";
        if (API_KEY !== "") {
            keyString = "&api_key=" + encodeURIComponent(API_KEY);
        }
        
        // Convert chosen date to a timestamp format for the API
        let dateObj = new Date(date + "T12:00:00Z");
        let timestamp = Math.floor(dateObj.getTime() / 1000);
        
        let url = "https://min-api.cryptocompare.com/data/v2/histoday?fsym=" + currency + "&tsym=EUR&limit=10&toTs=" + timestamp + keyString;
        let historical = await fetchJson(url);
        let rows = historical.Data.Data;
        
        // Loop backward to find the closest valid price to our date
        let boughtAt = 0;
        for (let i = rows.length - 1; i >= 0; i--) {
            if (rows[i].close > 0) {
                boughtAt = rows[i].close;
                break;
            }
        }
        
        if (boughtAt === 0) {
            throw new Error("No price found.");
        }

        let prices = await getLivePrices();
        let id = currencies[currency].coinId;
        let currentEur = prices[id].eur;

        let initialValue = amount * boughtAt;
        let currentValue = amount * currentEur;
        let change = currentValue - initialValue;
        let percent = (change / initialValue) * 100;
        
        let suggestion = "Hold or review your position.";
        if (percent >= 25) {
            suggestion = "You have gained over 25%. Consider selling a portion to lock in gains.";
        } else if (percent < 0) {
            suggestion = "The position has lost value. Consider holding patiently if it fits your risk plan.";
        }

        output.textContent = "Initial value: €" + initialValue.toFixed(2) + ". Current value: €" + currentValue.toFixed(2) + ". Change: " + percent.toFixed(2) + "%. Advice: " + suggestion;
        
    } catch (error) {
        output.textContent = "Could not calculate portfolio. Check the date and try again.";
    }
}

async function shareChart(service) {
    let chart = charts[selectedChartId];
    if (chart === undefined) {
        setStatus("Select a chart first.");
        return;
    }
    
    let chartNames = chart.currencies.map(function(currency) { return currencies[currency].name; }).join(" and ");
    let text = "My " + chartNames + " chart from Money & Crypto Portal.";
    let postUrl = "";
    
    if (service === "x") {
        postUrl = "https://twitter.com/intent/tweet?text=" + encodeURIComponent(text);
    } else {
        postUrl = "https://www.reddit.com/submit?title=Chart&text=" + encodeURIComponent(text);
    }
    
    downloadSelectedChart();
    window.open(postUrl, "_blank");
    setStatus("Chart SVG downloaded. You can attach it to your post.");
}

