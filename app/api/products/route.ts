import { NextResponse } from 'next/server';

export interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  image: string;
  description: string;
  stock: string;
}

const PRODUCTS: Product[] = [
  {
    id: "201",
    name: "Artisan Signature Kopi Susu Gula Aren",
    price: 32000,
    category: "Minuman",
    image: "https://images.unsplash.com/photo-1541167760496-1628856ab772?q=80&w=600&auto=format&fit=crop",
    description: "Espresso pilihan berpadu susu segar creamy dan manisnya gula aren asli berkualitas tinggi.",
    stock: "Ready (Dingin / Panas)"
  },
  {
    id: "202",
    name: "Croissant Butter Premium Artisanal",
    price: 28000,
    category: "Pastry & Bakery",
    image: "https://images.unsplash.com/photo-1555507036-ab1f4038808a?q=80&w=600&auto=format&fit=crop",
    description: "Pastry renyah di luar, lembut di dalam dengan lapisan butter Prancis pilihan yang harum.",
    stock: "Ready (Fresh Baked)"
  },
  {
    id: "203",
    name: "Chicken Truffle Mushroom Pasta",
    price: 65000,
    category: "Main Course",
    image: "https://images.unsplash.com/photo-1621996346565-e3d5d6281298?q=80&w=600&auto=format&fit=crop",
    description: "Fettuccine al dente dengan saus krim jamur truffle hitam mewah dan potongan dada ayam tender.",
    stock: "Ready Stock"
  },
  {
    id: "204",
    name: "Matcha Latte Ceremonial Grade",
    price: 38000,
    category: "Minuman",
    image: "https://images.unsplash.com/photo-1536256263959-770b48d82b0a?q=80&w=600&auto=format&fit=crop",
    description: "Teh hijau matcha autentik jepang berpadu susu lembut dengan rasa umami khas.",
    stock: "Ready (Hot / Ice)"
  },
  {
    id: "205",
    name: "Wagyu Beef Truffle Burger",
    price: 85000,
    category: "Main Course",
    image: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?q=80&w=600&auto=format&fit=crop",
    description: "Burger daging wagyu juicy dengan keju leleh, saus rahasia truffle, dan kentang goreng renyah.",
    stock: "Ready Stock"
  }
];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const query = searchParams.get('q');

  if (id) {
    const product = PRODUCTS.find(p => p.id === id);
    if (!product) {
      return NextResponse.json({ error: 'Produk tidak ditemukan' }, { status: 404 });
    }
    return NextResponse.json(product);
  }

  if (query) {
    const filtered = PRODUCTS.filter(p => 
      p.name.toLowerCase().includes(query.toLowerCase()) ||
      p.category.toLowerCase().includes(query.toLowerCase()) ||
      p.description.toLowerCase().includes(query.toLowerCase())
    );
    return NextResponse.json(filtered);
  }

  return NextResponse.json(PRODUCTS);
}
