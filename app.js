let ws;
let token;

function getTokenFromURL() {
    const hash = window.location.hash;

    if (hash.includes("token=")) {
        const t = hash.split("token=")[1];
        localStorage.setItem("deriv_token", t);
        window.location = "dashboard.html";
    }
}

getTokenFromURL();

token = localStorage.getItem("deriv_token");

if (token) {
    connectDeriv();
} else if (window.location.pathname.includes("dashboard.html")) {
    document.getElementById("status").innerText = "No token found — please login.";
}

function connectDeriv() {
    ws = new WebSocket(`wss://ws.deriv.com/websockets/v3?app_id=112604`);

    ws.onopen = () => {
        document.getElementById("status").innerText = "Connected to Deriv.";
        authorize();
    };

    ws.onmessage = (msg) => {
        const data = JSON.parse(msg.data);

        if (data.msg_type === "authorize") {
            getBalance();
            subscribeTicks();
        }

        if (data.msg_type === "balance") {
            document.getElementById("balanceBox").innerText =
                "Balance: $" + data.balance.balance;
        }

        if (data.msg_type === "tick") {
            updateTick(data.tick.quote);
        }
    };
}

function authorize() {
    ws.send(JSON.stringify({ authorize: token }));
}

function getBalance() {
    ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
}

function subscribeTicks() {
    ws.send(JSON.stringify({
        ticks: "R_100",
        subscribe: 1
    }));
}

function updateTick(price) {
    const str = String(price);
    const p = str.split(".");
    const last = p[1].slice(-1);

    document.getElementById("tickBox").innerHTML =
        p[0] + "." + p[1].slice(0, -1) +
        `<b style="color: yellow;">${last}</b>`;
}

function logout() {
    localStorage.removeItem("deriv_token");
    window.location.href = "login.html";
}
