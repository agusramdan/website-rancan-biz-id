'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  ShoppingBag, ChevronRight, CheckCircle2, Phone, MapPin, Clock, 
  Coffee, Utensils, Award, Sparkles, MessageSquare
} from 'lucide-react';

interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  image: string;
  description: string;
  stock: string;
}

export default function LandingPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState('Semua');

  useEffect(() => {
    fetch('/api/products')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setProducts(data);
        }
        setLoading(false);
      })
      .catch(err => {
        console.error('Gagal memuat produk:', err);
        setLoading(false);
      });
  }, []);

  const formatRupiah = (number: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0
    }).format(number);
  };

  const categories = ['Semua', 'Coffee', 'Main Course', 'Pastry', 'Beverage'];

  const filteredProducts = selectedCategory === 'Semua' 
    ? products 
    : products.filter(p => p.category.toLowerCase() === selectedCategory.toLowerCase());

  return (
    <div className="min-h-screen flex flex-col bg-stone-50 text-stone-900 font-sans">
      {/* Top Navbar */}
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-stone-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-full bg-stone-900 flex items-center justify-center text-white font-serif text-xl font-bold">
              R
            </div>
            <div>
              <span className="font-serif text-2xl font-bold tracking-tight text-stone-900">Rancan</span>
              <span className="block text-xs uppercase tracking-widest text-stone-500 font-semibold">Kafe & Resto</span>
            </div>
          </div>
          
          <nav className="hidden md:flex items-center space-x-8 text-sm font-medium text-stone-700">
            <a href="#katalog" className="hover:text-stone-900 transition-colors">Katalog Menu</a>
            <a href="#tentang" className="hover:text-stone-900 transition-colors">Filosofi Kami</a>
            <a href="#kontak" className="hover:text-stone-900 transition-colors">Lokasi & Kontak</a>
          </nav>

          <div className="flex items-center space-x-4">
            <Link
              href="/chat"
              aria-label="Halaman Chat CS"
              className="md:hidden w-10 h-10 rounded-full border border-stone-300 text-stone-700 flex items-center justify-center hover:bg-stone-100 transition-all"
            >
              <MessageSquare className="w-4 h-4" />
            </Link>
            <Link 
              href="/chat"
              className="bg-stone-900 text-white px-5 py-2.5 rounded-full text-sm font-medium hover:bg-stone-800 transition-all flex items-center space-x-2 shadow-sm"
            >
              <MessageSquare className="w-4 h-4" />
              <span>Tanya CS / Pesan</span>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative bg-stone-900 text-white overflow-hidden py-24 lg:py-32">
        <div className="absolute inset-0 opacity-20 bg-[radial-gradient(#d4d4d4_1px,transparent_1px)] [background-size:16px_16px]"></div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center max-w-3xl">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-stone-800 border border-stone-700 text-stone-300 text-xs font-medium mb-6">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>Kualitas Artisan Kelas Menengah-Atas</span>
          </div>
          <h1 className="font-serif text-4xl sm:text-6xl font-bold tracking-tight mb-6 leading-tight">
            Kenikmatan Autentik dalam Setiap Sajian
          </h1>
          <p className="text-lg sm:text-xl text-stone-300 mb-10 leading-relaxed font-light">
            Nikmati pilihan kopi spesialti, hidangan utama berkelas, dan pastry segar setiap hari. Konsultasikan selera kuliner Anda langsung dengan tim profesional kami melalui widget obrolan di pojok kanan bawah.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center space-y-4 sm:space-y-0 sm:space-x-4">
            <a 
              href="#katalog"
              className="w-full sm:w-auto bg-amber-700 text-white px-8 py-4 rounded-full font-medium hover:bg-amber-600 transition-all shadow-md text-center"
            >
              Jelajahi Katalog Menu
            </a>
            <Link 
              href="/chat"
              className="w-full sm:w-auto bg-stone-800 hover:bg-stone-700 text-white border border-stone-700 px-8 py-4 rounded-full font-medium transition-all text-center flex items-center justify-center space-x-2"
            >
              <MessageSquare className="w-4 h-4 text-amber-400" />
              <span>Mulai Percakapan CS</span>
            </Link>
          </div>
        </div>
      </section>

      {/* Katalog Menu Section */}
      <section id="katalog" className="py-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full flex-grow">
        <div className="text-center mb-12">
          <h2 className="font-serif text-3xl sm:text-4xl font-bold text-stone-900 mb-3">Katalog Menu Pilihan</h2>
          <p className="text-stone-600 max-w-xl mx-auto">
            Data menu tersinkronisasi langsung dari sistem Odoo. Stok dan harga diperbarui secara real-time.
          </p>

          {/* Category Filter Pills */}
          <div className="flex flex-wrap items-center justify-center gap-2 mt-8">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-5 py-2 rounded-full text-sm font-medium transition-all ${
                  selectedCategory === cat 
                    ? 'bg-stone-900 text-white shadow-sm' 
                    : 'bg-stone-200 text-stone-700 hover:bg-stone-300'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center items-center py-24">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-stone-900"></div>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="text-center py-20 text-stone-500">
            Tidak ada produk ditemukan untuk kategori ini.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {filteredProducts.map((product) => (
              <div 
                key={product.id}
                className="bg-white rounded-2xl border border-stone-200 overflow-hidden shadow-sm hover:shadow-md transition-shadow flex flex-col"
              >
                <div className="h-56 bg-stone-100 relative overflow-hidden">
                  <img 
                    src={product.image || 'https://images.unsplash.com/photo-1554118811-1e0d58224f24?auto=format&fit=crop&q=80&w=800'} 
                    alt={product.name}
                    className="w-full h-full object-cover object-center hover:scale-105 transition-transform duration-500"
                  />
                  <span className="absolute top-4 left-4 bg-white/90 backdrop-blur-sm px-3 py-1 rounded-full text-xs font-semibold text-stone-800">
                    {product.category}
                  </span>
                </div>
                <div className="p-6 flex flex-col flex-grow">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-serif text-xl font-bold text-stone-900">{product.name}</h3>
                    <span className="text-amber-800 font-semibold text-lg">{formatRupiah(product.price)}</span>
                  </div>
                  <p className="text-stone-600 text-sm mb-6 flex-grow leading-relaxed">
                    {product.description}
                  </p>
                  <div className="flex items-center justify-between pt-4 border-t border-stone-100 mt-auto">
                    <span className="text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full">
                      {product.stock}
                    </span>
                    <button 
                      onClick={() => {
                        window.location.href = '/chat';
                      }}
                      className="text-sm font-medium text-stone-900 hover:text-amber-700 flex items-center space-x-1 transition-colors"
                    >
                      <span>Pesan via Chat</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Filosofi Section */}
      <section id="tentang" className="bg-stone-100 py-24 border-y border-stone-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 md:grid-cols-3 gap-12 text-center">
          <div className="p-6">
            <div className="w-14 h-14 bg-amber-100 text-amber-800 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <Coffee className="w-7 h-7" />
            </div>
            <h3 className="font-serif text-xl font-bold text-stone-900 mb-3">Biji Kopi Pilihan</h3>
            <p className="text-stone-600 text-sm leading-relaxed">
              Dipetik langsung dari petani lokal pilihan dengan proses sangrai artisan demi citarasa premium yang konsisten.
            </p>
          </div>
          <div className="p-6">
            <div className="w-14 h-14 bg-amber-100 text-amber-800 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <Utensils className="w-7 h-7" />
            </div>
            <h3 className="font-serif text-xl font-bold text-stone-900 mb-3">Freshly Baked & Prepared</h3>
            <p className="text-stone-600 text-sm leading-relaxed">
              Semua hidangan dan pastry dibuat segar setiap hari menggunakan bahan-bahan organik berkualitas tinggi.
            </p>
          </div>
          <div className="p-6">
            <div className="w-14 h-14 bg-amber-100 text-amber-800 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <Award className="w-7 h-7" />
            </div>
            <h3 className="font-serif text-xl font-bold text-stone-900 mb-3">Pelayanan Omnichannel</h3>
            <p className="text-stone-600 text-sm leading-relaxed">
              Terhubung langsung dengan asisten cerdas dan staf profesional kami untuk konsultasi menu dan pemesanan instan.
            </p>
          </div>
        </div>
      </section>

      {/* Footer / Kontak */}
      <footer id="kontak" className="bg-stone-900 text-stone-400 py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 md:grid-cols-3 gap-10 mb-12">
          <div>
            <div className="flex items-center space-x-3 mb-4">
              <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-stone-900 font-serif font-bold">
                R
              </div>
              <span className="font-serif text-xl font-bold text-white">Rancan Kafe & Resto</span>
            </div>
            <p className="text-sm leading-relaxed">
              Destinasi kuliner premium untuk Anda yang menghargai kualitas, kelezatan, dan pelayanan terbaik.
            </p>
          </div>
          <div>
            <h4 className="text-white font-semibold mb-4 text-sm tracking-wider uppercase">Jam Operasional</h4>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center space-x-2">
                <Clock className="w-4 h-4 text-amber-500" />
                <span>Senin - Jumat: 08.00 - 22.00 WIB</span>
              </li>
              <li className="flex items-center space-x-2">
                <Clock className="w-4 h-4 text-amber-500" />
                <span>Sabtu - Minggu: 07.00 - 23.00 WIB</span>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="text-white font-semibold mb-4 text-sm tracking-wider uppercase">Kontak & Lokasi</h4>
            <ul className="space-y-3 text-sm">
              <li className="flex items-start space-x-2">
                <MapPin className="w-4 h-4 text-amber-500 mt-1 flex-shrink-0" />
                <span>Jl. Senopati No. 45, Kebayoran Baru, Jakarta Selatan</span>
              </li>
              <li className="flex items-center space-x-2">
                <Phone className="w-4 h-4 text-amber-500" />
                <span>+62 811-9988-7766</span>
              </li>
            </ul>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 border-t border-stone-800 text-center text-xs text-stone-500">
          &copy; {new Date().getFullYear()} PT Rancan Boga Nusantara. All rights reserved. Pure Omnichannel Chatwoot Architecture.
        </div>
      </footer>
    </div>
  );
}
