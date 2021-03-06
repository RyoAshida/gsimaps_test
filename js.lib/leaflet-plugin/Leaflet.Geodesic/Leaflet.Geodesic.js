"use strict";

// This file is part of Leaflet.Geodesic.
// Copyright (C) 2017  Henry Thasler
// based on code by Chris Veness Copyright (C) 2014 https://github.com/chrisveness/geodesy
//
// Leaflet.Geodesic is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Leaflet.Geodesic is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with Leaflet.Geodesic.  If not, see <http://www.gnu.org/licenses/>.



/** Extend Number object with method to convert numeric degrees to radians */
if (typeof Number.prototype.toRadians === "undefined") {
  Number.prototype.toRadians = function() {
    return this * Math.PI / 180
  }
}

/** Extend Number object with method to convert radians to numeric (signed) degrees */
if (typeof Number.prototype.toDegrees === "undefined") {
  Number.prototype.toDegrees = function() {
    return this * 180 / Math.PI
  }
}

var INTERSECT_LNG = 179.999 // Lng used for intersection and wrap around on map edges

L.Geodesic = L.Polyline.extend({
  options: {
    color: "blue",
    steps: 10,
    dash: 1,
    wrap: true
  },

  initialize: function(latlngs, options) {
    this.options = this._merge_options(this.options, options)
    this.datum = {}
    this.datum.ellipsoid = {
        a: 6378137,
        b: 6356752.3142,
        f: 1 / 298.257223563
      } // WGS-84
    this._latlngs = (this.options.dash < 1) ? this._generate_GeodesicDashed(
      latlngs) : this._generate_Geodesic(latlngs)
    L.Polyline.prototype.initialize.call(this, this._latlngs, this.options)
  },

  setLatLngs: function(latlngs) {
    this._latlngs = (this.options.dash < 1) ? this._generate_GeodesicDashed(
      latlngs) : this._generate_Geodesic(latlngs)
    L.Polyline.prototype.setLatLngs.call(this, this._latlngs)
  },

  /**
   * Calculates some statistic values of current geodesic multipolyline
   * @returns (Object} Object with several properties (e.g. overall distance)
   */
  getStats: function() {
    var obj = {
        distance: 0,
        points: 0,
        polygons: this._latlngs.length
      },
      poly, points

    for (poly = 0; poly < this._latlngs.length; poly++) {
      obj.points += this._latlngs[poly].length
      for (points = 0; points < (this._latlngs[poly].length - 1); points++) {
        obj.distance += this._vincenty_inverse(this._latlngs[poly][points],
          this._latlngs[poly][points + 1]).distance
      }
    }
    return obj
  },


  /**
   * Creates geodesic lines from geoJson. Replaces all current features of this instance.
   * Supports LineString, MultiLineString and Polygon
   * @param {Object} geojson - geosjon as object.
   */
  geoJson: function(geojson) {

    var normalized = L.GeoJSON.asFeature(geojson)
    var features = normalized.type === "FeatureCollection" ? normalized.features : [
      normalized
    ]
    this._latlngs = [];
    for (var feature in features) {
      var geometry = feature.type === "Feature" ? feature.geometry :
        feature,
        coords = geometry.coordinates

      switch (geometry.type) {
        case "LineString":
          this._latlngs.push(this._generate_Geodesic([L.GeoJSON.coordsToLatLngs(
            coords, 0)]))
          break
        case "MultiLineString":
        case "Polygon":
          this._latlngs.push(this._generate_Geodesic(L.GeoJSON.coordsToLatLngs(
            coords, 1)))
          break
        case "Point":
        case "MultiPoint":
          console.log("Dude, points can't be drawn as geodesic lines...")
          break
        default:
          console.log("Drawing " + geometry.type +
            " as a geodesic is not supported. Skipping...")
      }
    }
    L.Polyline.prototype.setLatLngs.call(this, this._latlngs)
  },

  /**
   * Creates a great circle. Replaces all current lines.
   * @param {Object} center - geographic position
   * @param {number} radius - radius of the circle in metres
   */
  createCircle: function(center, radius) {
    var polylineIndex = 0
    var prev = {
      lat: 0,
      lng: 0,
      brg: 0
    }
    var step

    this._latlngs = []
    this._latlngs[polylineIndex] = []

    var direct = this._vincenty_direct(L.latLng(center), 0, radius, this.options
      .wrap)
    prev = L.latLng(direct.lat, direct.lng)
    this._latlngs[polylineIndex].push(prev)
    for (step = 1; step <= this.options.steps;) {
      direct = this._vincenty_direct(L.latLng(center), 360 / this.options
        .steps * step, radius, this.options.wrap)
      var gp = L.latLng(direct.lat, direct.lng)
      if (Math.abs(gp.lng - prev.lng) > 180) {
        var inverse = this._vincenty_inverse(prev, gp)
        var sec = this._intersection(prev, inverse.initialBearing, {
          lat: -89,
          lng: ((gp.lng - prev.lng) > 0) ? -INTERSECT_LNG : INTERSECT_LNG
        }, 0)
        if (sec) {
          this._latlngs[polylineIndex].push(L.latLng(sec.lat, sec.lng))
          polylineIndex++
          this._latlngs[polylineIndex] = []
          prev = L.latLng(sec.lat, -sec.lng)
          this._latlngs[polylineIndex].push(prev)
        } else {
          polylineIndex++
          this._latlngs[polylineIndex] = []
          this._latlngs[polylineIndex].push(gp)
          prev = gp
          step++
        }
      } else {
        this._latlngs[polylineIndex].push(gp)
        prev = gp
        step++
      }
    }

    L.Polyline.prototype.setLatLngs.call(this, this._latlngs)
  },

  /**
   * Creates a geodesic Polyline from given coordinates
   * @param {Object} latlngs - One or more polylines as an array. See Leaflet doc about Polyline
   * @returns (Object} An array of arrays of geographical points.
   */
  _generate_Geodesic: function(latlngs) {
    var _geo = [],
      _geocnt = 0,
      s, poly, points, pointA, pointB

    for (poly = 0; poly < latlngs.length; poly++) {
      _geo[_geocnt] = []
      for (points = 0; points < (latlngs[poly].length - 1); points++) {
        pointA = L.latLng(latlngs[poly][points])
        pointB = L.latLng(latlngs[poly][points + 1])
        if (pointA.equals(pointB)) {
          continue;
        }
        var inverse = this._vincenty_inverse(pointA, pointB)
        var prev = pointA
        _geo[_geocnt].push(prev)
        for (s = 1; s <= this.options.steps;) {
          var direct = this._vincenty_direct(pointA, inverse.initialBearing,
            inverse.distance / this.options.steps * s, this.options.wrap
          )
          var gp = L.latLng(direct.lat, direct.lng)
          if (Math.abs(gp.lng - prev.lng) > 180) {
            var sec = this._intersection(pointA, inverse.initialBearing, {
              lat: -89,
              lng: ((gp.lng - prev.lng) > 0) ? -INTERSECT_LNG : INTERSECT_LNG
            }, 0)
            if (sec) {
              _geo[_geocnt].push(L.latLng(sec.lat, sec.lng))
              _geocnt++
              _geo[_geocnt] = []
              prev = L.latLng(sec.lat, -sec.lng)
              _geo[_geocnt].push(prev)
            } else {
              _geocnt++
              _geo[_geocnt] = []
              _geo[_geocnt].push(gp)
              prev = gp
              s++
            }
          } else {
            _geo[_geocnt].push(gp)
            prev = gp
            s++
          }
        }
      }
      _geocnt++
    }
    return _geo
  },


  /**
   * Creates a dashed geodesic Polyline from given coordinates - under work
   * @param {Object} latlngs - One or more polylines as an array. See Leaflet doc about Polyline
   * @returns (Object} An array of arrays of geographical points.
   */
  _generate_GeodesicDashed: function(latlngs) {
    var _geo = [],
      _geocnt = 0,
      s, poly, points
      //      _geo = latlngs;    // bypass

    for (poly = 0; poly < latlngs.length; poly++) {
      _geo[_geocnt] = []
      for (points = 0; points < (latlngs[poly].length - 1); points++) {
        var inverse = this._vincenty_inverse(L.latLng(latlngs[poly][
          points
        ]), L.latLng(latlngs[poly][points + 1]))
        var prev = L.latLng(latlngs[poly][points])
        _geo[_geocnt].push(prev)
        for (s = 1; s <= this.options.steps;) {
          var direct = this._vincenty_direct(L.latLng(latlngs[poly][
              points
            ]), inverse.initialBearing, inverse.distance / this.options
            .steps * s - inverse.distance / this.options.steps * (1 -
              this.options.dash), this.options.wrap)
          var gp = L.latLng(direct.lat, direct.lng)
          if (Math.abs(gp.lng - prev.lng) > 180) {
            var sec = this._intersection(L.latLng(latlngs[poly][points]),
              inverse.initialBearing, {
                lat: -89,
                lng: ((gp.lng - prev.lng) > 0) ? -INTERSECT_LNG : INTERSECT_LNG
              }, 0)
            if (sec) {
              _geo[_geocnt].push(L.latLng(sec.lat, sec.lng))
              _geocnt++
              _geo[_geocnt] = []
              prev = L.latLng(sec.lat, -sec.lng)
              _geo[_geocnt].push(prev)
            } else {
              _geocnt++
              _geo[_geocnt] = []
              _geo[_geocnt].push(gp)
              prev = gp
              s++
            }
          } else {
            _geo[_geocnt].push(gp)
            _geocnt++
            var direct2 = this._vincenty_direct(L.latLng(latlngs[poly][
                points
              ]), inverse.initialBearing, inverse.distance / this.options
              .steps * s, this.options.wrap)
            _geo[_geocnt] = []
            _geo[_geocnt].push(L.latLng(direct2.lat, direct2.lng))
            s++
          }
        }
      }
      _geocnt++
    }
    return _geo
  },


  /**
   * Vincenty direct calculation.
   * based on the work of Chris Veness (https://github.com/chrisveness/geodesy)
   *
   * @private
   * @param {number} initialBearing - Initial bearing in degrees from north.
   * @param {number} distance - Distance along bearing in metres.
   * @returns (Object} Object including point (destination point), finalBearing.
   */

  _vincenty_direct: function(p1, initialBearing, distance, wrap) {
    var ??1 = p1.lat.toRadians(),
      ??1 = p1.lng.toRadians();
    var ??1 = initialBearing.toRadians();
    var s = distance;

    var a = this.datum.ellipsoid.a,
      b = this.datum.ellipsoid.b,
      f = this.datum.ellipsoid.f;

    var sin??1 = Math.sin(??1);
    var cos??1 = Math.cos(??1);

    var tanU1 = (1 - f) * Math.tan(??1),
      cosU1 = 1 / Math.sqrt((1 + tanU1 * tanU1)),
      sinU1 = tanU1 * cosU1;
    var ??1 = Math.atan2(tanU1, cos??1);
    var sin?? = cosU1 * sin??1;
    var cosSq?? = 1 - sin?? * sin??;
    var uSq = cosSq?? * (a * a - b * b) / (b * b);
    var A = 1 + uSq / 16384 * (4096 + uSq * (-768 + uSq * (320 - 175 *
      uSq)));
    var B = uSq / 1024 * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));

    var ?? = s / (b * A),
      ????, iterations = 0;
    do {
      var cos2??M = Math.cos(2 * ??1 + ??);
      var sin?? = Math.sin(??);
      var cos?? = Math.cos(??);
      var ???? = B * sin?? * (cos2??M + B / 4 * (cos?? * (-1 + 2 * cos2??M *
          cos2??M) -
        B / 6 * cos2??M * (-3 + 4 * sin?? * sin??) * (-3 + 4 * cos2??M *
          cos2??M)));
      ???? = ??;
      ?? = s / (b * A) + ????;
    } while (Math.abs(?? - ????) > 1e-12 && ++iterations);

    var x = sinU1 * sin?? - cosU1 * cos?? * cos??1;
    var ??2 = Math.atan2(sinU1 * cos?? + cosU1 * sin?? * cos??1, (1 - f) *
      Math.sqrt(sin?? * sin?? + x * x));
    var ?? = Math.atan2(sin?? * sin??1, cosU1 * cos?? - sinU1 * sin?? * cos??1);
    var C = f / 16 * cosSq?? * (4 + f * (4 - 3 * cosSq??));
    var L = ?? - (1 - C) * f * sin?? *
      (?? + C * sin?? * (cos2??M + C * cos?? * (-1 + 2 * cos2??M * cos2??M)));

    if (wrap)
      var ??2 = (??1 + L + 3 * Math.PI) % (2 * Math.PI) - Math.PI; // normalise to -180...+180
    else
      var ??2 = (??1 + L); // do not normalize

    var revAz = Math.atan2(sin??, -x);

    return {
      lat: ??2.toDegrees(),
      lng: ??2.toDegrees(),
      finalBearing: revAz.toDegrees()
    };
  },

  /**
   * Vincenty inverse calculation.
   * based on the work of Chris Veness (https://github.com/chrisveness/geodesy)
   *
   * @private
   * @param {LatLng} p1 - Latitude/longitude of start point.
   * @param {LatLng} p2 - Latitude/longitude of destination point.
   * @returns {Object} Object including distance, initialBearing, finalBearing.
   * @throws {Error} If formula failed to converge.
   */
  _vincenty_inverse: function(p1, p2) {
    var ??1 = p1.lat.toRadians(),
      ??1 = p1.lng.toRadians();
    var ??2 = p2.lat.toRadians(),
      ??2 = p2.lng.toRadians();

    var a = this.datum.ellipsoid.a,
      b = this.datum.ellipsoid.b,
      f = this.datum.ellipsoid.f;

    var L = ??2 - ??1;
    var tanU1 = (1 - f) * Math.tan(??1),
      cosU1 = 1 / Math.sqrt((1 + tanU1 * tanU1)),
      sinU1 = tanU1 * cosU1;
    var tanU2 = (1 - f) * Math.tan(??2),
      cosU2 = 1 / Math.sqrt((1 + tanU2 * tanU2)),
      sinU2 = tanU2 * cosU2;

    var ?? = L,
      ????, iterations = 0;
    do {
      var sin?? = Math.sin(??),
        cos?? = Math.cos(??);
      var sinSq?? = (cosU2 * sin??) * (cosU2 * sin??) + (cosU1 * sinU2 -
        sinU1 * cosU2 * cos??) * (cosU1 * sinU2 - sinU1 * cosU2 * cos??);
      var sin?? = Math.sqrt(sinSq??);
      if (sin?? == 0) return 0; // co-incident points
      var cos?? = sinU1 * sinU2 + cosU1 * cosU2 * cos??;
      var ?? = Math.atan2(sin??, cos??);
      var sin?? = cosU1 * cosU2 * sin?? / sin??;
      var cosSq?? = 1 - sin?? * sin??;
      var cos2??M = cos?? - 2 * sinU1 * sinU2 / cosSq??;
      if (isNaN(cos2??M)) cos2??M = 0; // equatorial line: cosSq??=0 (??6)
      var C = f / 16 * cosSq?? * (4 + f * (4 - 3 * cosSq??));
      ???? = ??;
      ?? = L + (1 - C) * f * sin?? * (?? + C * sin?? * (cos2??M + C * cos?? * (-
        1 + 2 * cos2??M * cos2??M)));
    } while (Math.abs(?? - ????) > 1e-12 && ++iterations < 100);
    if (iterations >= 100) {
      console.log("Formula failed to converge. Altering target position.")
      return this._vincenty_inverse(p1, {
          lat: p2.lat,
          lng: p2.lng - 0.01
        })
        //  throw new Error('Formula failed to converge');
    }

    var uSq = cosSq?? * (a * a - b * b) / (b * b);
    var A = 1 + uSq / 16384 * (4096 + uSq * (-768 + uSq * (320 - 175 *
      uSq)));
    var B = uSq / 1024 * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
    var ???? = B * sin?? * (cos2??M + B / 4 * (cos?? * (-1 + 2 * cos2??M *
        cos2??M) -
      B / 6 * cos2??M * (-3 + 4 * sin?? * sin??) * (-3 + 4 * cos2??M *
        cos2??M)));

    var s = b * A * (?? - ????);

    var fwdAz = Math.atan2(cosU2 * sin??, cosU1 * sinU2 - sinU1 * cosU2 *
      cos??);
    var revAz = Math.atan2(cosU1 * sin??, -sinU1 * cosU2 + cosU1 * sinU2 *
      cos??);

    s = Number(s.toFixed(3)); // round to 1mm precision
    return {
      distance: s,
      initialBearing: fwdAz.toDegrees(),
      finalBearing: revAz.toDegrees()
    };
  },


  /**
   * Returns the point of intersection of two paths defined by point and bearing.
   * based on the work of Chris Veness (https://github.com/chrisveness/geodesy)
   *
   * @param {LatLon} p1 - First point.
   * @param {number} brng1 - Initial bearing from first point.
   * @param {LatLon} p2 - Second point.
   * @param {number} brng2 - Initial bearing from second point.
   * @returns {Object} containing lat/lng information of intersection.
   *
   * @example
   * var p1 = LatLon(51.8853, 0.2545), brng1 = 108.55;
   * var p2 = LatLon(49.0034, 2.5735), brng2 = 32.44;
   * var pInt = LatLon.intersection(p1, brng1, p2, brng2); // pInt.toString(): 50.9078??N, 4.5084??E
   */
  _intersection: function(p1, brng1, p2, brng2) {
    // see http://williams.best.vwh.net/avform.htm#Intersection

    var ??1 = p1.lat.toRadians(),
      ??1 = p1.lng.toRadians();
    var ??2 = p2.lat.toRadians(),
      ??2 = p2.lng.toRadians();
    var ??13 = Number(brng1).toRadians(),
      ??23 = Number(brng2).toRadians();
    var ???? = ??2 - ??1,
      ???? = ??2 - ??1;

    var ??12 = 2 * Math.asin(Math.sqrt(Math.sin(???? / 2) * Math.sin(???? / 2) +
      Math.cos(??1) * Math.cos(??2) * Math.sin(???? / 2) * Math.sin(???? /
        2)));
    if (??12 == 0) return null;

    // initial/final bearings between points
    var ??1 = Math.acos((Math.sin(??2) - Math.sin(??1) * Math.cos(??12)) /
      (Math.sin(??12) * Math.cos(??1)));
    if (isNaN(??1)) ??1 = 0; // protect against rounding
    var ??2 = Math.acos((Math.sin(??1) - Math.sin(??2) * Math.cos(??12)) /
      (Math.sin(??12) * Math.cos(??2)));

    if (Math.sin(??2 - ??1) > 0) {
      var ??12 = ??1;
      var ??21 = 2 * Math.PI - ??2;
    } else {
      var ??12 = 2 * Math.PI - ??1;
      var ??21 = ??2;
    }

    var ??1 = (??13 - ??12 + Math.PI) % (2 * Math.PI) - Math.PI; // angle 2-1-3
    var ??2 = (??21 - ??23 + Math.PI) % (2 * Math.PI) - Math.PI; // angle 1-2-3

    if (Math.sin(??1) == 0 && Math.sin(??2) == 0) return null; // infinite intersections
    if (Math.sin(??1) * Math.sin(??2) < 0) return null; // ambiguous intersection

    //??1 = Math.abs(??1);
    //??2 = Math.abs(??2);
    // ... Ed Williams takes abs of ??1/??2, but seems to break calculation?

    var ??3 = Math.acos(-Math.cos(??1) * Math.cos(??2) +
      Math.sin(??1) * Math.sin(??2) * Math.cos(??12));
    var ??13 = Math.atan2(Math.sin(??12) * Math.sin(??1) * Math.sin(??2),
      Math.cos(??2) + Math.cos(??1) * Math.cos(??3))
    var ??3 = Math.asin(Math.sin(??1) * Math.cos(??13) +
      Math.cos(??1) * Math.sin(??13) * Math.cos(??13));
    var ????13 = Math.atan2(Math.sin(??13) * Math.sin(??13) * Math.cos(??1),
      Math.cos(??13) - Math.sin(??1) * Math.sin(??3));
    var ??3 = ??1 + ????13;
    ??3 = (??3 + 3 * Math.PI) % (2 * Math.PI) - Math.PI; // normalise to -180..+180??

    return {
      lat: ??3.toDegrees(),
      lng: ??3.toDegrees()
    };
  },

  /**
   * Overwrites obj1's values with obj2's and adds obj2's if non existent in obj1
   * @param obj1
   * @param obj2
   * @returns obj3 a new object based on obj1 and obj2
   */
  _merge_options: function(obj1, obj2) {
    var obj3 = {};
    for (var attrname in obj1) {
      obj3[attrname] = obj1[attrname];
    }
    for (var attrname in obj2) {
      obj3[attrname] = obj2[attrname];
    }
    return obj3;
  }
});

L.geodesic = function(latlngs, options) {
  return new L.Geodesic(latlngs, options);
};
