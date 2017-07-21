import {HttpContext, IFunctionRequest, HttpStatusCodes} from 'azure-functions-typescript'
import * as request from 'request-promise';
import * as storage from 'azure-storage';
import {parseString} from 'xml2js';

const blobSvc = storage.createBlobService();

interface Annotation {
    visual: string;
    functional: string;
    historical: string;
    social: string;
}

interface TileId {
    zoom: 16;
    x: Number;
    y: Number;
}

interface Feature {
    properties: {string: string};
    osm_ids: Number[];
    // other properties of feature ommitted as not relevant
}

interface TileBlob {
    type: "FeatureCollection";
    features: Feature[];
}

function saveAnnotationBlob(annotation: Annotation, callback) {
    const options: request.RequestPromiseOptions = {
        body: JSON.stringify(annotation)
    }
    const url = "http://msrnexusaltgeo.cloudapp.net/AltGeoService.svc/PostAnnotation";
    request.post(url, options, (error, response, body) => {
        if (error) return callback(error, null);
        parseString(body, (error, result) => {
            if (error) return callback(error, null);
            const location = `http://msrnexusaltgeo.cloudapp.net/AltGeoService.svc/GetAnnotation/${result.string._}`;
            callback(null, location);
        })
    })
}

export function editAnnotation(context: HttpContext, req: IFunctionRequest) {
    context.log("recieved request");
    // TODO: validate these incoming params
    const annotation: Annotation = req.body.alt;
    const tileId: TileId = req.body.tile;
    const id: string = req.body.id;
    saveAnnotationBlob(annotation, (error, annotationUrl) => {
        if (error) {
            context.log(`error while saving annotation blob: ${error.message}`);
            return context.done(error);
        }
        const blobId = `16/${tileId.x}/${tileId.y}.json`;
        blobSvc.getBlobToText('tiles', blobId,  (error, result, response) => {
            if (error) {
                context.log(`error while getting tile: ${error.message}`);
                return context.done(error);
            }
            const tile: TileBlob = JSON.parse(result);
            const feature = tile.features.find(feature => feature.osm_ids.indexOf(Number(id)) > -1);
            if (!feature) {
                context.log(`could not find corresponding entity (${id}) in tile ${blobId}`);
                context.res.status = 404;
                context.res.body = "Tile not found.";
                return context.done(null);
            }
            feature.properties['blind:website:en'] = annotationUrl;
            blobSvc.createBlockBlobFromText('tiles', blobId, JSON.stringify(tile), (error, result, response) => {
                if (error) {
                    context.log(`error while saving tile: ${error.message}`);
                    return context.done(error);
                }
                context.res.status = 200;
                context.res.body = tile;
                context.done(null);
            });
        });
    });
}