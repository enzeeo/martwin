"""Shared continent names and footprint policy for preparation and scoring."""

from typing import Literal, get_args

Continent = Literal["Africa", "Antarctica", "Asia", "Europe", "North America", "Oceania", "South America"]
CONTINENTS = get_args(Continent)
CONTINENT_POLICY = "Only cells whose entire grid footprint falls inside one selected continent are eligible."
