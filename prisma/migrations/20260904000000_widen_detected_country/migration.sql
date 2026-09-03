-- detectedCountry now carries city and country in one readable value — "New Delhi, IN" — and a
-- bare country code wherever the offline GeoLite2 table names no city. Two characters no longer
-- fit, hence the widening.
--
-- The column keeps its name so nothing downstream has to be renamed, but it is no longer an
-- ISO-3166 code and must not be compared to one. Anything needing the country alone should read
-- the last comma-separated segment.
ALTER TABLE "User" ALTER COLUMN "detectedCountry" TYPE VARCHAR(120);
