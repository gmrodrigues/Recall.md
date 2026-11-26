CREATE TABLE deployment_probe (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  marker TEXT NOT NULL
);

INSERT INTO deployment_probe (id, marker) VALUES (1, 'recall-online-pilot');
