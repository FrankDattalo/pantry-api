const path = require('path');
const pg = require('pg');
const express = require('express');
const bodyParser = require('body-parser');

// Utility function for retrieving data from enviroment variables
// an exception will be thrown in the event of the variable not being set
const getFromEnv = function(name) {
    const ret = process.env[name];
    if (!ret) {
        throw new Error(`${name} was not set!`);
    }
    return ret;
};

// Pulls the environment variables, will throw an exception if unset
const PORT = getFromEnv('PORT');
const DATABASE_URL = getFromEnv('DATABASE_URL');

const db = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: true,
});

// connect to the database
db.connect((err) => {
    if (err) {
        throw err;
    }
});

// the regular expression used for parsing expiration dates
const EXPIRATION_REGEX = /\d{4}-\d{2}-\d{2}/;

// Instantiates the application
const app = express();

// Allows for parsing of JSON bodies into objects
app.use(bodyParser.json());

// assigns the port to listen on to the env variable
app.set('port', PORT);

// Response used to indicate a non-user based error
const internalError = (response, error) => {
    response.statusCode = 500;
    response.statusMessage = "Internal Error.";
    response.end();
    console.log(error);
};

// Response used to indicate a user based error
const userError = (response, error) => {
    response.statusCode = 400;
    response.statusMessage = error;
    response.end();
};

// function which is response for inserting an item into the database
const insertItem = (item, callback) => {
    const query = `
        INSERT INTO PANTRY (NAME, EXPIRATION, QUANTITY) 
        VALUES ($1, $2, $3)
        RETURNING ID`;

    const params = [item.name, item.expiration, item.quantity];

    db.query(query, params, (err, result) => {
        item.id = result.rows[0].id;
        callback(err, item);
    });
};

const itemExists = (item, callback) => {
    const query = `SELECT COUNT(*) FROM PANTRY WHERE ID = $1`;
    const params = [item.id];

    db.query(query, params, (err, result) => {
        callback(result.rows[0] === 1);
    })
};

// function which is response for updating an item in the database
const updateItem = (item, callback) => {
    itemExists(item, (exists) => {
        if (!exists) {
            callback(undefined, {present: false, item: undefined});
            return;
        }

        const updateQuery = `
            UPDATE PANTRY SET 
            NAME = $1,
            EXPIRATION = $2,
            QUANTITY = $3
            WHERE ID = $4`;

        const updateParams = [
            item.name, item.expiration, item.quantity, item.id];
    
        db.query(updateQuery, updateParams, (err, result) => {
            callback(err, item);
        });
    });
};

// function which is responsible for deleting an item in the database
const deleteItem = (item, callback) => {
    itemExists(item, (exists) => {
        if (!exists) {
            callback(undefined, {present: false, item: undefined});
            return;
        }

        const deleteQuery = `DELETE FROM PANTRY WHERE ID = $1`;

        const deleteParams = [item.id];
    
        db.query(deleteQuery, deleteParams, (err, result) => {
            callback(err, item);
        });
    });
};

const dateObjectToString = (item) => {
    item.expiration = item.expiration.toLocaleDateString();
    return item;
};

// function which is responsible for retrieving all the items from the database
const getItems = (callback) => {
    const selectQuery = `
        SELECT NAME as name, 
        QUANTITY as quantity, 
        EXPIRATION as expiration,
        ID as id 
        FROM PANTRY`;

    db.query(selectQuery, [], (err, result) => {
        callback(err, result.rows.map(dateObjectToString));  
    });
};

// Gets the name parameter from the request
// if the parameter is invalid, a response will be sent indicating this
// and the return value of this function will be undefined
const getValidateName = (request, response) => {
    const name = request.body.name;

    if (!name) {
        userError(response, 'name was undefined.');
        return;
    }

    if (typeof(name) !== 'string' || name.length == 0) {
        userError(response, 'name was not a string or was empty.');
        return;
    }

    return name;
};

// Gets the quantity parameter from the request
// if the parameter is invalid, a response will be sent indicating this
// and the return value of this function will be undefined
const getValidatedQuantity = (request, response) => {
    const quantity = request.body.quantity;
    
    if (!quantity) {
        userError(response, 'quantity was undefined.');
        return;
    }

    if (typeof(quantity) !== 'number' || quantity < 1) {
        userError(response, 'quantity was not a number or was less than 1.');
        return;
    }

    return quantity;
};

// Retrieves the expiration from the request
// if the parameter is invalid, a response will be sent indicating this
// and the return value of this function will be undefined
const getValidatedExpiration = (request, response) => {
    const expiration = request.body.expiration;

    if (!expiration) {
        userError(response, 'expiration was undefined.');
        return;
    }

    if(typeof(expiration) !== 'string' || !EXPIRATION_REGEX.test(expiration)) {
        userError(response, 'expiration date was not a string ' + 
                            'or it was not of the format YYYY-MM-DD.');
        return;
    }

    return expiration;
};

// Retrieves the id from the request
// if the parameter is invalid, a response will be sent indicating this
// and the return value of this function will be undefined
const getValidatedId = (request, response) => {
    let id = request.params.id;
    
    if (!id) {
        userError(response, 'id was undefined.');
        return;
    }

    id = parseInt(id);

    if (isNaN(id)) {
        userError(response, 'id was not a number.');
        return;
    }

    return id;
};

// GET /
// Retrieves all items in the system
app.get('/', (request, response) => {
    getItems((err, items) => {
        if (err) {
            internalError(response, err);
            return;
        }

        response.json(items);
    });
});

// POST /
// inserts the item from the body, returns that item
app.post('/', (request, response) => {

    const name = getValidateName(request, response);
    const quantity = getValidatedQuantity(request, response);
    const expiration = getValidatedExpiration(request, response);

    // if any of them were invalid, response was already sent and we can
    // quit execution
    if (!name || !quantity || !expiration) {
        return;
    }

    const item = {name, quantity, expiration};

    insertItem(item, (err, item) => {
        if (err) {
            internalError(response, err);
            return;
        }

        response.json(item);
    });
});

// DELETE /:id
// Deletes the item with the given id, returns that item
app.delete('/:id', (request, response) => {
    
    const id = getValidatedId(request, response);

    // if the id was not valid a response has been already sent, stop executing
    if (!id) {
        return;
    }

    deleteItem(id, (err, result) => {
        if (err) {
            internalError(response, err);
            return;
        }

        if (!result.present) {
            userError(response, `Item with id ${id} not found.`);
            return;
        }

        response.json(result.item);
    });
});

// POST /:id
// Updates the item with the given id, returns that item
app.post('/:id', (request, response) => {

    const name = getValidateName(request, response);
    const quantity = getValidatedQuantity(request, response);
    const expiration = getValidatedExpiration(request, response);
    const id = getValidatedId(request, response);

    // if any of the params were invalid, response was 
    // already sent and we can quit execution
    if (!name || !quantity || !expiration || !id) {
        return;
    }

    const item = {name, quantity, expiration, id};

    updateItem(item, (err, result) => {
        if (err) {
            internalError(response, err);
            return;
        }

        if (!result.present) {
            userError(response, `Item with id ${id} not found.`);
            return;
        }

        response.json(result.item);
    });
});

// Listens on the specified port
app.listen(app.get('port'), () => {
    console.log(`Started listening on port ${app.get('port')}`);
});
