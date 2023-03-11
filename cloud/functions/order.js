var Gerencianet = require("gn-api-sdk-node");

const Order = Parse.Object.extend("Order");
const OrderItem = Parse.Object.extend("OrderItem");
const CartItem = Parse.Object.extend("CartItem");
const GnEvent = Parse.Object.extend("GnEvent");

const product = require("./product");


var options = {
    sandbox: false,
    //client_id: "Client_Id_a6fdf8c300d7d2d7788b555f6f792aa159bc3ee4",
    client_id: "Client_Id_6ec49f00e6bf82607bf22d45b2827e2c0409eafb",
    //client_secret: "Client_Secret_ac63bd6cb232b8df7d09792afadbcf705b7b3ea2",
    client_secret: "Client_Secret_625fb3d9d784869001ebf0f4b015a7f01455466c",
    //certificate: __dirname + "/certs/homologacao-417192-Mercadinho - Homolog.p12",
    certificate: __dirname + "/certs/producao-417192-Mercadinho.p12",
};

var gerencianet = new Gerencianet(options);

Date.prototype.addSeconds = function(s) {
    this.setTime(this.getTime() + (s*1000));
    return this;
}

Parse.Cloud.define("checkout", async (req) => {
    if(req.user == null) throw "INVALID_USER";

    const queryCartItems = new Parse.Query(CartItem);
    queryCartItems.equalTo("user", req.user);
    queryCartItems.include("product");
    const resultCartItems = await queryCartItems.find({useMasterKey: true});

    let total = 0;
    for(let item of resultCartItems){
        item = item.toJSON();
        total += item.quantity * item.product.price;
    }

    if(req.params.total != total)throw "INVALID_TOTAL";

    const dueSeconds = 3600;
    const due = new Date().addSeconds(dueSeconds);

    const charge = await createCharge(dueSeconds, req.user.get("cpf"), req.user.get("fullname"), total);
    const qrCodeData = await generateQRCode(charge.loc.id);

    const order = new Order();
    order.set("total", total);
    order.set("user", req.user);
    order.set("dueDate", due);
    order.set("qrCodeImage", qrCodeData.imagemQrcode);
    order.set("qrCode", qrCodeData.qrcode);
    order.set("txid", charge.txid);
    order.set("status", "pending_payment");
    const savedOrder = await order.save(null, {useMasterKey: true});

    for(let item of resultCartItems){
        const orderItem = new OrderItem();
        orderItem.set("order", savedOrder);
        orderItem.set("user", req.user);
        orderItem.set("product", item.get("product"));
        orderItem.set("quantity", item.get("quantity"));
        orderItem.set("price", item.toJSON().product.price);
        await orderItem.save(null, {useMasterKey: true});
    }

    await Parse.Object.destroyAll(resultCartItems, {useMasterKey: true});

    return {
        id: savedOrder.id,
        total: total,
        qrCodeImage: qrCodeData.imagemQrcode,
        copiaecola: qrCodeData.qrcode,
        due: due.toISOString(),
        status: "pending_payment",
    }
});

Parse.Cloud.define("get-orders", async (req) => {
    if(req.user == null) throw "INVALID_USER";

    const queryOrders = new Parse.Query(Order);
    queryOrders.equalTo("user", req.user);
    const resultOrders = await queryOrders.find({useMasterKey: true});
    return resultOrders.map(function (o) {
        o = o.toJSON();
        return {
            id: o.objectId,
            total: o.total,
            createdAt: o.createdAt,
            due: o.dueDate.iso,
            qrCodeImage: o.qrCodeImage,
            copiaecola: o.qrCode,
            status: o.status,
        }
    });
});

Parse.Cloud.define("get-orders-items", async (req) => {
    if(req.params.orderId == null) throw "INVALID_ORDER";
    if(req.user == null) throw "INVALID_USER";

    const order = new Order();
    order.id = req.params.orderId;

    const queryOrderItems = new Parse.Query(OrderItem);
    queryOrderItems.equalTo("order", order);
    queryOrderItems.equalTo("user", req.user);
    queryOrderItems.include("product");
    queryOrderItems.include("product.category");
    const resultOrderItems = await queryOrderItems.find({useMasterKey: true});
    return resultOrderItems.map(function (o) {
        o = o.toJSON();
        return {
            id:o.objectId,
            quantity: o.quantity,
            price: o.price,
            product: product.formatProduct(o.product)
        }
    });
});

Parse.Cloud.define("refund-order", async (req) => {
    if(req.params.orderId == null) throw "INVALID_ORDER";

    const queryOrder = new Parse.Query(Order);
    let order;
    try{
        order = await queryOrder.get(req.params.orderId, {useMasterKey: true});
    }catch (e) {
        throw "INVALID_ORDER";
    }

    if(order.get("status") != "paid") throw "INVALID_STATUS";

    await pixDevolution(order.get("total"), order.get("e2eId"), new Date().getTime());

    order.set("status", "requested_refund");
    await order.save(null, {useMasterKey: true});
});

Parse.Cloud.define("webhook", async (req) => {
    if(req.user == null) throw "INVALID_USER";
    if(req.user.id != "t1eyAe1M5Z") throw "INVALID_USER";
    return "Ola mundo!";
});

Parse.Cloud.define("pix", async (req) => {
    if(req.user == null) throw "INVALID_USER";
    if(req.user.id != "t1eyAe1M5Z") throw "INVALID_USER";

    for(const e of req.params.pix) {
        const gnEvent = new GnEvent();
        gnEvent.set("eid", e.endToEndId);
        gnEvent.set("txid", e.txid);
        gnEvent.set("event", e);
        await gnEvent.save(null, {useMasterKey: true});

        const query = new Parse.Query(Order);
        query.equalTo("txid", e.txid);

        const order = await query.first({useMasterKey: true});
        if(order == null) {
            throw "NOT_FOUND";
        }

        if(e.devolucoes == null) {
           order.set("status", "paid");
           order.set("e2eId", e.endToEndId);
        } else {
            if(e.devolucoes[0].status == "EM_PROCESSAMENTO"){
                order.set("status", "panding_refund");
            } else if(e.devolucoes[0].status == "DEVOLVIDO"){
                order.set("status", "refunded");
            }
        }

        await order.save(null, {useMasterKey: true});
    }
});

Parse.Cloud.define("config-webhook", async (req) => {
    let body = {
    	webhookUrl: "https://api.wesleidev.com.br/prod/webhook",
    }

    let params = {
    	chave: "weslei.t123@gmail.com",
    }

    return await gerencianet.pixConfigWebhook(params, body);
});

Parse.Cloud.define("list-charges", async (req) => {
        let params = {
        	inicio: req.params.inicio,
        	fim: req.params.fim,
        }

        return await gerencianet.pixListCharges(params);
});

async function createCharge(dueSeconds, cpf, fullName, price) {
    let body = {
    	"calendario": {
    		"expiracao": dueSeconds,
    	},
    	"devedor": {
    		"cpf": cpf.replace(/\D/g,''),
    		"nome": fullName,
    	},
    	"valor": {
    		"original": price.toFixed(2),
    	},
    	"chave": "weslei.t123@gmail.com",
    }

    const response = await gerencianet.pixCreateImmediateCharge([], body);
    return response;
}

async function generateQRCode(locId){
    let params = {
    	id: locId,
    }

    const response = await gerencianet.pixGenerateQRCode(params);
    return response;
}

async function pixDevolution(value, e2eId, id) {
    let body = {
    	valor: value.toFixed(2),
    }

    let params = {
    	e2eId: e2eId,
    	id: id,
    }

    return await gerencianet.pixDevolution(params, body);
}
