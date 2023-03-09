var Gerencianet = require("gn-api-sdk-node");

const Order = Parse.Object.extend("Order");
const OrderItem = Parse.Object.extend("OrderItem");
const CartItem = Parse.Object.extend("CartItem");

const product = require("./product");


var options = {
    sandbox: true,
    client_id: "Client_Id_a6fdf8c300d7d2d7788b555f6f792aa159bc3ee4",
    client_secret: "Client_Secret_ac63bd6cb232b8df7d09792afadbcf705b7b3ea2",
    certificate: __dirname + "/homologacao-417192-Mercadinho - Homolog.p12",
//    __dirname +
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
            copiaecola: o.qrCode
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

Parse.Cloud.define("webhook", async (req) => {
    if(req.user == null) throw "INVALID_USER";
    if(req.user.id != "t1eyAe1M5Z") throw "INVALID_USER";
    return "Ola mundo!";
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