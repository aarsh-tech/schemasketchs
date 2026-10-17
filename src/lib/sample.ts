export const SAMPLE_NAME = 'Bookshop'

export const SAMPLE_DBML = `// A small online bookshop. Edit anything on this side;
// the diagram redraws as you type.

Project bookshop {
  database_type: 'PostgreSQL'
  Note: 'Orders, books and the people who buy them'
}

Enum order_status {
  pending
  paid
  shipped
  cancelled [note: 'Refund issued separately']
}

Table customers {
  id integer [pk, increment]
  email varchar(255) [unique, not null]
  full_name varchar(120) [not null]
  created_at timestamp [default: \`now()\`]
  Note: 'One row per registered buyer'
}

Table addresses {
  id integer [pk, increment]
  customer_id integer [not null, ref: > customers.id]
  line_1 varchar(200) [not null]
  city varchar(80)
  postcode varchar(12)
}

Table orders {
  id integer [pk, increment]
  customer_id integer [not null, ref: > customers.id]
  shipping_address_id integer [ref: > addresses.id]
  status order_status [default: 'pending']
  placed_at timestamp [default: \`now()\`]
}

Table order_items {
  order_id integer [ref: > orders.id]
  book_id integer [ref: > books.id]
  quantity integer [not null, default: 1]
  unit_price decimal(10,2) [not null]

  indexes {
    (order_id, book_id) [pk]
  }
}

Table books [headercolor: #3B6EA5] {
  id integer [pk, increment]
  isbn varchar(13) [unique]
  title varchar(255) [not null]
  publisher_id integer [ref: > publishers.id]
  price decimal(10,2) [not null]
}

Table publishers [headercolor: #3B6EA5] {
  id integer [pk, increment]
  name varchar(150) [not null]
}

Table authors [headercolor: #3B6EA5] {
  id integer [pk, increment]
  name varchar(150) [not null]
}

// many-to-many through a join table
Table book_authors [headercolor: #3B6EA5] {
  book_id integer [ref: > books.id]
  author_id integer [ref: > authors.id]

  indexes {
    (book_id, author_id) [pk]
  }
}

TableGroup catalogue [color: #3B6EA5] {
  books
  publishers
  authors
  book_authors
}

Note shipping_rules {
  '''
  Orders ship only once status = paid.
  Addresses are kept even after an order ships.
  '''
}
`
