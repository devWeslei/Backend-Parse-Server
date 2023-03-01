const Product = Parse.Object.extend("Product");
const Category = Parse.Object.extend("Category");

Parse.Cloud.define("hello", (req) => {
	return "Hello world from mercadinho";
});

Parse.Cloud.define("get-product-list", async (req) => {
    const queryProducts = new Parse.Query(Product);

    //condições da query

    if(req.params.title != null){
        queryProducts.fullText('title', req.params.title);
        //queryProducts.matches('title', '.*' + req.params.title + '.*');
    }

    if(req.params.categoryId != null){
        const category = new Category();
        category.id = req.params.categoryId;

        queryProducts.equalTo('category', category);
    }

    const itemsPerPage = req.params.itemsPerPage || 20;
    if(itemsPerPage > 50) throw "Quantidade inválida de itens por página";

    queryProducts.skip(itemsPerPage * req.params.page || 0);
    queryProducts.limit(itemsPerPage);

    queryProducts.include('category');

    const resultProducts = await queryProducts.find({useMasterKey: true});

    return resultProducts.map(function (p) {
        p = p.toJSON();
        return {
            id: p.objectId,
            title: p.title,
            description: p.description,
            price: p.price,
            unit: p.unit,
            picture: p.picture != null ? p.picture.url : null,
            category: {
                title: p.category.title,
                id: p.category.objectId
            },
        }
    });
});

Parse.Cloud.define("get-category-list", async (req) => {
    const queryCategories = new Parse.Query(Category);

    //Condições

    const resultCategories = await queryCategories.find({useMasterKey: true});
    return resultCategories.map(function (c){
        c = c.toJSON();
        return {
            title: c.title,
            id: c.objectId
        }
    });
});
